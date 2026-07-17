/**
 * Acquisition channels.
 *
 * The `referrer` dimension doesn't store raw hosts — `normalizeReferrer` in
 * enrich/referrer.ts has already resolved them to names a human recognizes
 * ("Google", "Reddit", "Direct"). That means channels need no new column and no
 * migration: they're a second grouping over rows that already exist, folding
 * those names up one more level.
 *
 * The source names live in enrich/referrer.ts (EXACT / SUFFIX). A name added
 * there and not added here lands in "Referral", which is the correct answer for
 * an unrecognized referrer anyway — so drift degrades quietly instead of
 * breaking.
 *
 * Known limitation: this reads the referrer only. Rollups store `referrer` and
 * `utm_medium` as separate rows with no way to join them back per event, so a
 * link tagged `utm_medium=cpc` is still counted under whatever referred it
 * rather than as paid. Pulse therefore has no Paid channel — an empty-but-
 * plausible "Paid Search" bucket would imply an attribution Pulse cannot do.
 */

export type Channel = 'Direct' | 'Organic Search' | 'AI' | 'Social' | 'Email' | 'Referral';

const ORGANIC_SEARCH = new Set([
  'Google', 'Bing', 'DuckDuckGo', 'Yahoo', 'Yandex', 'Baidu',
  'Ecosia', 'Brave Search', 'Marginalia', 'Kagi',
]);

// Assistants are split out rather than folded into search. They behave nothing
// like a search referral — no query, no ranking — and for most of the people
// running Pulse this is the number they actually want to watch right now.
const AI = new Set(['Perplexity', 'ChatGPT', 'Claude', 'Gemini']);

const SOCIAL = new Set([
  'Twitter', 'Reddit', 'Facebook', 'Instagram', 'LinkedIn', 'YouTube', 'TikTok',
  'Pinterest', 'Mastodon', 'Bluesky', 'Threads', 'VK',
  'Discord', 'Slack', 'Telegram', 'WhatsApp',
  // Community aggregators sit here rather than in Referral: traffic from them
  // spikes and decays like social traffic, not like a steady backlink.
  'Hacker News', 'Lobsters', 'Product Hunt', 'Indie Hackers',
]);

const EMAIL = new Set(['Gmail']);

export function channelOf(source: string): Channel {
  if (source === 'Direct') return 'Direct';
  if (ORGANIC_SEARCH.has(source)) return 'Organic Search';
  if (AI.has(source)) return 'AI';
  if (SOCIAL.has(source)) return 'Social';
  if (EMAIL.has(source)) return 'Email';
  return 'Referral';
}

/** Display order: how people read an acquisition report, not alphabetical. */
const ORDER: Channel[] = ['Direct', 'Organic Search', 'AI', 'Social', 'Email', 'Referral'];

export interface ChannelRow {
  value: Channel;
  hits: number;
  visitors: number;
}

/**
 * How many source rows to fold into channels.
 *
 * Not a display limit — the six channels are always shown in full. This is how
 * deep into the source tail we read before folding, and it exists because
 * `pulse_owner_breakdown` ranks and cuts in SQL.
 *
 * 500 is chosen against the shape of the data: `normalizeReferrer` already
 * collapses every known source to one of ~40 names, so the only thing making up
 * the tail is unrecognized hosts, and referrer hits are power-law distributed.
 * A project would need 500+ distinct referring domains in one window before
 * anything is dropped, and what dropped would be single-hit rows. PostgREST
 * caps responses at 1000 regardless, so this cannot be raised past that without
 * aggregating in SQL — which would mean duplicating the tables above into
 * Postgres and keeping two copies honest.
 */
export const CHANNEL_FOLD_LIMIT = 500;

/**
 * Fold source rows into channel rows.
 *
 * Pass the WIDEST source list available, not the top handful. Folding a top-12
 * list would produce channel totals that silently omit the long tail and
 * understate Referral — the same class of truncation bug the rollup queries
 * already carry scar tissue about (see queries.ts). Callers use CHANNEL_FOLD_LIMIT.
 *
 * Visitors are summed, which double-counts anyone who arrived from two sources
 * in the same bucket. That's the same approximation `sumTotals` already makes
 * and documents — deduplicating would mean going back to raw events, which is
 * exactly what the rollups exist to avoid. Ranking is by hits for that reason.
 */
export function toChannels(
  rows: Array<{ value: string; hits: number; visitors: number }>
): ChannelRow[] {
  const totals = new Map<Channel, { hits: number; visitors: number }>();

  for (const row of rows) {
    const channel = channelOf(row.value);
    const acc = totals.get(channel) ?? { hits: 0, visitors: 0 };
    acc.hits += row.hits;
    acc.visitors += row.visitors;
    totals.set(channel, acc);
  }

  return ORDER.filter((c) => totals.has(c))
    .map((c) => ({ value: c, hits: totals.get(c)!.hits, visitors: totals.get(c)!.visitors }))
    .sort((a, b) => b.hits - a.hits);
}
