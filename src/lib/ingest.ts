/**
 * The ingest pipeline (Section 5), factored out of the route so it can be unit
 * tested without an HTTP server or a database.
 *
 * The route handles transport; everything that decides *what gets recorded*
 * lives here.
 */

import { parseUserAgent, screenBucket } from './enrich/ua';
import { normalizeReferrer, extractUTM } from './enrich/referrer';
import { detectBot, type BotFilterLevel } from './enrich/bots';
import { computeVisitorHash } from './enrich/visitor';
import { toMinorUnits } from './money';

/** The wire format the tracker sends. Single letters: it's on the hot path. */
export interface RawEvent {
  /** project ingest key */
  k?: unknown;
  /** event name */
  n?: unknown;
  /** page href */
  u?: unknown;
  /** referrer */
  r?: unknown;
  /** viewport width */
  w?: unknown;
  /** custom properties, may contain `revenue` */
  p?: unknown;
}

export interface ProjectConfig {
  id: string;
  domains: string[];
  bot_filter: BotFilterLevel;
  excluded_paths: string[];
  respect_dnt: boolean;
}

export interface IngestContext {
  project: ProjectConfig;
  salt: string;
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  region: string | null;
}

export interface RevenueClaim {
  amount: number;
  currency: string;
  amountMinor: number;
}

export interface PreparedEvent {
  project_id: string;
  name: string;
  is_pageview: boolean;
  path: string | null;
  referrer_host: string | null;
  referrer_group: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  device: string;
  browser: string;
  os: string;
  country: string | null;
  region: string | null;
  screen_bucket: string | null;
  visitor_hash: string;
  revenue_amount: number | null;
  revenue_currency: string | null;
  props: Record<string, unknown> | null;
}

export type IngestResult =
  | { ok: true; event: PreparedEvent; revenue: RevenueClaim | null }
  | { ok: false; reason: string; status: number };

const MAX_NAME = 64;
const MAX_PATH = 1024;
const MAX_PROPS_KEYS = 24;
const MAX_PROP_LEN = 500;

/**
 * Validate + enrich a raw payload into a row.
 *
 * Returns a reason rather than throwing so the route can decide how loud to be.
 * Rejections are still 202 to the client — see the route for why.
 */
export async function prepareEvent(raw: RawEvent, ctx: IngestContext): Promise<IngestResult> {
  const { project } = ctx;

  // ---- name ----------------------------------------------------------------
  const name = typeof raw.n === 'string' ? raw.n.trim().slice(0, MAX_NAME) : '';
  if (!name) return { ok: false, reason: 'missing event name', status: 400 };

  const isPageview = name === 'pageview';

  // ---- url -----------------------------------------------------------------
  if (typeof raw.u !== 'string' || !raw.u) {
    return { ok: false, reason: 'missing url', status: 400 };
  }

  let url: URL;
  try {
    url = new URL(raw.u);
  } catch {
    return { ok: false, reason: 'unparseable url', status: 400 };
  }

  // ---- domain allow-list ---------------------------------------------------
  // The real defense against forged events. The ingest key is public by
  // necessity (it ships in the script tag), so it cannot be the thing that
  // authorizes a write.
  if (project.domains.length > 0 && !domainAllowed(url.hostname, project.domains)) {
    return { ok: false, reason: `domain ${url.hostname} not allowed`, status: 403 };
  }

  // ---- path ----------------------------------------------------------------
  // Hash routers put the route in the fragment, which the History API never
  // sees. Treating "#/settings" as part of the path is what makes SPA hash
  // routing show up as distinct pages instead of every view collapsing onto "/".
  let path = url.pathname;
  if (url.hash && url.hash.startsWith('#/')) path += url.hash;
  path = path.slice(0, MAX_PATH);

  if (isExcluded(path, project.excluded_paths)) {
    return { ok: false, reason: 'path excluded', status: 202 };
  }

  // ---- bots ----------------------------------------------------------------
  const width = typeof raw.w === 'number' && Number.isFinite(raw.w) ? raw.w : null;
  const bot = detectBot({
    userAgent: ctx.userAgent,
    level: project.bot_filter,
    screenWidth: width,
    hasReferrer: typeof raw.r === 'string' && raw.r.length > 0,
  });
  if (bot.isBot) return { ok: false, reason: `bot: ${bot.reason}`, status: 202 };

  // ---- enrichment ----------------------------------------------------------
  const ua = parseUserAgent(ctx.userAgent);
  const referrer = normalizeReferrer(typeof raw.r === 'string' ? raw.r : null, url.hostname);
  const utm = extractUTM(url.searchParams);

  // Everything in the query string other than the UTM keys stops here. It is
  // never written; `path` above is already query-free.
  const visitorHash = await computeVisitorHash({
    salt: ctx.salt,
    projectId: project.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  // ---- props + revenue -----------------------------------------------------
  const { props, revenue } = extractProps(raw.p);

  const event: PreparedEvent = {
    project_id: project.id,
    name,
    is_pageview: isPageview,
    path,
    referrer_host: referrer.host,
    referrer_group: referrer.group,
    ...utm,
    device: ua.device,
    browser: ua.browser,
    os: ua.os,
    country: ctx.country,
    region: ctx.region,
    screen_bucket: screenBucket(width),
    visitor_hash: visitorHash,
    revenue_amount: revenue ? revenue.amount : null,
    revenue_currency: revenue ? revenue.currency : null,
    props,
  };

  return { ok: true, event, revenue };
}

/**
 * Domain matching. An entry also covers its subdomains, so adding "example.com"
 * doesn't require separately listing "www.example.com" and "blog.example.com" —
 * the alternative is a footgun that silently drops real traffic.
 */
export function domainAllowed(hostname: string, domains: string[]): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return domains.some((d) => {
    const allowed = d.trim().toLowerCase().replace(/^www\./, '');
    if (!allowed) return false;
    return host === allowed || host.endsWith('.' + allowed);
  });
}

/** Exact match, or prefix match when the pattern ends in `*`. */
export function isExcluded(path: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    const pattern = p.trim();
    if (!pattern) return false;
    if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
    return path === pattern;
  });
}

/**
 * Pull `revenue` out of the custom props and validate it.
 *
 * Rejecting a bad revenue claim rather than coercing it is deliberate: a
 * NaN or negative amount silently written as 0 would corrupt a public money
 * figure, and money is the number people will actually check.
 */
export function extractProps(input: unknown): {
  props: Record<string, unknown> | null;
  revenue: RevenueClaim | null;
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { props: null, revenue: null };
  }

  const source = input as Record<string, unknown>;
  let revenue: RevenueClaim | null = null;
  const props: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (key === 'revenue') {
      revenue = parseRevenue(value);
      continue;
    }
    if (Object.keys(props).length >= MAX_PROPS_KEYS) break;

    // Only scalars. Nested objects would let a caller push unbounded JSON into
    // the busiest table in the database.
    if (typeof value === 'string') props[key] = value.slice(0, MAX_PROP_LEN);
    else if (typeof value === 'number' && Number.isFinite(value)) props[key] = value;
    else if (typeof value === 'boolean') props[key] = value;
  }

  return {
    props: Object.keys(props).length > 0 ? props : null,
    revenue,
  };
}

function parseRevenue(value: unknown): RevenueClaim | null {
  if (!value || typeof value !== 'object') return null;

  const v = value as Record<string, unknown>;
  const amount = typeof v.amount === 'number' ? v.amount : Number(v.amount);
  if (!Number.isFinite(amount) || amount < 0) return null;

  const currency =
    typeof v.currency === 'string' && /^[A-Za-z]{3}$/.test(v.currency)
      ? v.currency.toUpperCase()
      : 'USD';

  return { amount, currency, amountMinor: toMinorUnits(amount, currency) };
}
