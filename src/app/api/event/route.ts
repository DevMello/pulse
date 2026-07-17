/**
 * The collector (Section 5).
 *
 * Runs on the edge: the work is tiny, the writes are frequent, and latency is
 * paid by someone else's visitors. Everything expensive — aggregation, session
 * stitching, breakdowns — is deferred to the scheduled rollups so this stays a
 * validate-enrich-insert and nothing more.
 *
 * Response policy: almost every outcome is 202, including rejections.
 * The client is fire-and-forget and ignores the response entirely, so a status
 * code cannot help it. What a status code *can* do is tell an attacker whether
 * a project key exists, whether a domain is allow-listed, or whether their bot
 * evaded the filter. So the collector stays quiet and only distinguishes cases
 * the site owner can act on: a malformed payload (400), rate limiting (429),
 * and misconfiguration (503).
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin, ingestConfigured } from '@/lib/supabase/admin';
import { prepareEvent, type RawEvent, type ProjectConfig } from '@/lib/ingest';
import { clientIp } from '@/lib/enrich/visitor';
import { rateLimit } from '@/lib/ratelimit';
import { displayCurrency, parseFxRates, convertMinor } from '@/lib/money';

export const runtime = 'edge';
// Never cache a write.
export const dynamic = 'force-dynamic';

/** Accepted with no body — the client isn't listening. */
const ACCEPTED = new NextResponse(null, { status: 202 });

const MAX_BODY = 16 * 1024;

export async function POST(req: Request): Promise<NextResponse> {
  if (!ingestConfigured()) {
    return json({ error: 'ingestion not configured' }, 503);
  }

  // ---- rate limit ----------------------------------------------------------
  // Keyed on IP so one abusive client can't spend another project's budget.
  const ip = clientIp(req.headers);
  const limit = rateLimit(ip ?? 'unknown', { ratePerSecond: 10, burst: 40 });
  if (!limit.ok) {
    return new NextResponse(null, {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfter) },
    });
  }

  // ---- body ----------------------------------------------------------------
  // The tracker posts text/plain to dodge a CORS preflight, so the content type
  // is not a signal and the body is parsed by hand.
  let raw: RawEvent;
  try {
    const text = await req.text();
    if (!text || text.length > MAX_BODY) return json({ error: 'bad payload' }, 400);
    raw = JSON.parse(text);
  } catch {
    return json({ error: 'bad payload' }, 400);
  }

  const key = typeof raw.k === 'string' ? raw.k : null;
  if (!key) return json({ error: 'missing key' }, 400);

  const db = supabaseAdmin();

  // ---- project -------------------------------------------------------------
  const { data: project, error: projectError } = await db
    .from('projects')
    .select('id, domains, bot_filter, excluded_paths, respect_dnt, archived')
    .eq('ingest_key', key)
    .maybeSingle();

  if (projectError) return json({ error: 'lookup failed' }, 503);
  // Unknown key and archived project are indistinguishable from outside.
  if (!project || project.archived) return ACCEPTED;

  // ---- DNT / GPC -----------------------------------------------------------
  // The tracker already checks this client-side, but honoring the header here
  // too means the preference is respected even if someone integrates against
  // the endpoint directly rather than through our script.
  if (project.respect_dnt && signalsOptOut(req.headers)) return ACCEPTED;

  // ---- salt ----------------------------------------------------------------
  const { data: salt, error: saltError } = await db.rpc('current_visitor_salt');
  if (saltError || typeof salt !== 'string') return json({ error: 'salt unavailable' }, 503);

  // ---- prepare -------------------------------------------------------------
  const geo = readGeo(req);
  const result = await prepareEvent(raw, {
    project: project as ProjectConfig,
    salt,
    ip,
    userAgent: req.headers.get('user-agent'),
    country: geo.country,
    region: geo.region,
  });

  if (!result.ok) {
    // 400 is the one rejection worth surfacing: it means the integration is
    // broken, which is the owner's problem to fix and reveals nothing.
    return result.status === 400 ? json({ error: result.reason }, 400) : ACCEPTED;
  }

  // ---- write ---------------------------------------------------------------
  const { data: inserted, error: insertError } = await db
    .from('events')
    .insert(result.event)
    .select('id')
    .single();

  if (insertError) return json({ error: 'write failed' }, 503);

  // ---- SDK revenue ---------------------------------------------------------
  // Section 4.6 / 8.2: revenue sent through the SDK becomes a normalized record
  // in the same pipeline Stripe writes to, so every money query is one table.
  if (result.revenue && inserted) {
    const base = displayCurrency();
    const rates = parseFxRates(process.env.PULSE_FX_RATES);

    const { error: revenueError } = await db.from('revenue_records').insert({
      project_id: project.id,
      source: 'sdk',
      kind: 'one_time',
      amount_cents: result.revenue.amountMinor,
      currency: result.revenue.currency,
      amount_base_cents: convertMinor({
        amountMinor: result.revenue.amountMinor,
        from: result.revenue.currency,
        to: base,
        rates,
      }),
      base_currency: base,
      event_id: inserted.id,
    });

    // The pageview is already durable. A failed revenue row is worth knowing
    // about but not worth telling the client, which cannot retry anyway.
    if (revenueError) console.error('pulse: revenue insert failed', revenueError.message);
  }

  return ACCEPTED;
}

/** CORS preflight, for anyone posting JSON directly rather than via the tracker. */
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * Geo from the request Vercel already resolved (Section 13) — no GeoIP service,
 * no extra dependency, and the IP never leaves the function.
 */
function readGeo(req: Request): { country: string | null; region: string | null } {
  const h = req.headers;
  const country = h.get('x-vercel-ip-country');
  const region = h.get('x-vercel-ip-country-region');
  return {
    country: country && country !== 'XX' ? country : null,
    region: region || null,
  };
}

function signalsOptOut(h: Headers): boolean {
  return h.get('dnt') === '1' || h.get('sec-gpc') === '1';
}

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}
