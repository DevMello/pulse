import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Dashboard reads.
 *
 * Everything here goes through `rollups` / `rollup_dimensions`, never `events` —
 * that is the whole reason the rollup tables exist (Section 7). The one
 * exception is realtime, which is bounded to minutes and hits an index.
 *
 * Every function runs under the owner's session, so RLS scopes the rows. The
 * `.eq('project_id', …)` filters are for correctness, not security.
 */

export interface Project {
  id: string;
  name: string;
  slug: string;
  ingest_key: string;
  domains: string[];
  timezone: string;
  retention_days: number;
  bot_filter: 'off' | 'standard' | 'strict';
  excluded_paths: string[];
  respect_dnt: boolean;
  archived: boolean;
  created_at: string;
}

export interface Totals {
  pageviews: number;
  visitors: number;
  sessions: number;
  bounces: number;
  duration_sec: number;
  events: number;
  revenue_cents: number;
}

export interface SeriesPoint extends Totals {
  bucket: string;
}

export const EMPTY_TOTALS: Totals = {
  pageviews: 0, visitors: 0, sessions: 0, bounces: 0,
  duration_sec: 0, events: 0, revenue_cents: 0,
};

export type RangePreset = 'today' | '7d' | '30d' | '90d' | '12mo';

export interface DateRange {
  from: Date;
  to: Date;
  /** Hourly buckets for short ranges, daily beyond — a 12-month hourly chart
   *  would be 8,760 points nobody can read. */
  period: 'hour' | 'day';
  label: string;
}

export function resolveRange(preset: string | undefined): DateRange {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);

  switch (preset) {
    case 'today':
      return { from: startOfToday, to: now, period: 'hour', label: 'Today' };
    case '7d':
      return { from: daysAgo(startOfToday, 6), to: now, period: 'day', label: 'Last 7 days' };
    case '90d':
      return { from: daysAgo(startOfToday, 89), to: now, period: 'day', label: 'Last 90 days' };
    case '12mo':
      return { from: daysAgo(startOfToday, 364), to: now, period: 'day', label: 'Last 12 months' };
    case '30d':
    default:
      return { from: daysAgo(startOfToday, 29), to: now, period: 'day', label: 'Last 30 days' };
  }
}

/** The equivalent window immediately before `range`, for trend comparison. */
export function previousRange(range: DateRange): DateRange {
  const span = range.to.getTime() - range.from.getTime();
  return {
    from: new Date(range.from.getTime() - span),
    to: new Date(range.from.getTime()),
    period: range.period,
    label: 'Previous period',
  };
}

function daysAgo(from: Date, n: number): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

export async function getProjects(db: SupabaseClient, includeArchived = false): Promise<Project[]> {
  let query = db.from('projects').select('*').order('created_at', { ascending: true });
  if (!includeArchived) query = query.eq('archived', false);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load projects: ${error.message}`);
  return (data ?? []) as Project[];
}

export async function getProjectBySlug(db: SupabaseClient, slug: string): Promise<Project | null> {
  const { data, error } = await db.from('projects').select('*').eq('slug', slug).maybeSingle();
  if (error) throw new Error(`Failed to load project: ${error.message}`);
  return (data as Project) ?? null;
}

/** Rollup rows for the given projects and window. */
export async function getSeries(
  db: SupabaseClient,
  projectIds: string[],
  range: DateRange
): Promise<SeriesPoint[]> {
  if (projectIds.length === 0) return [];

  const { data, error } = await db
    .from('rollups')
    .select('bucket, pageviews, visitors, sessions, bounces, duration_sec, events, revenue_cents')
    .in('project_id', projectIds)
    .eq('period', range.period)
    .gte('bucket', range.from.toISOString())
    .lte('bucket', range.to.toISOString())
    .order('bucket', { ascending: true });

  if (error) throw new Error(`Failed to load series: ${error.message}`);

  // Several projects can share a bucket; merge them so a combined view sums.
  const merged = new Map<string, SeriesPoint>();
  for (const row of data ?? []) {
    const key = row.bucket as string;
    const existing = merged.get(key);
    if (existing) {
      existing.pageviews += row.pageviews;
      existing.visitors += row.visitors;
      existing.sessions += row.sessions;
      existing.bounces += row.bounces;
      existing.duration_sec += row.duration_sec;
      existing.events += row.events;
      existing.revenue_cents += row.revenue_cents;
    } else {
      merged.set(key, { ...(row as unknown as SeriesPoint), bucket: key });
    }
  }

  return [...merged.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

/**
 * Summing visitors across projects and buckets overstates uniques: one person
 * visiting on Monday and Tuesday is two daily rows. Deduplicating would mean
 * scanning raw events, which is exactly what rollups exist to avoid.
 *
 * So the number is labeled honestly in the UI rather than silently wrong: over
 * a multi-day range it's "visits", not "unique people". The methodology note
 * says so publicly (Section 10.4).
 */
export function sumTotals(series: SeriesPoint[]): Totals {
  return series.reduce<Totals>(
    (acc, p) => ({
      pageviews: acc.pageviews + p.pageviews,
      visitors: acc.visitors + p.visitors,
      sessions: acc.sessions + p.sessions,
      bounces: acc.bounces + p.bounces,
      duration_sec: acc.duration_sec + p.duration_sec,
      events: acc.events + p.events,
      revenue_cents: acc.revenue_cents + p.revenue_cents,
    }),
    { ...EMPTY_TOTALS }
  );
}

export function bounceRate(t: Totals): number | null {
  if (t.sessions === 0) return null;
  return (t.bounces / t.sessions) * 100;
}

export function avgDuration(t: Totals): number | null {
  // Bounced sessions have one event and therefore zero measurable duration.
  // Including them would drag the average toward zero and make it meaningless.
  const engaged = t.sessions - t.bounces;
  if (engaged <= 0) return null;
  return t.duration_sec / engaged;
}

export function pctChange(prev: number, cur: number): number | null {
  if (prev === 0 && cur === 0) return 0;
  if (prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

export interface DimensionRow {
  value: string;
  hits: number;
  visitors: number;
  revenue_cents: number;
}

export async function getBreakdown(
  db: SupabaseClient,
  projectIds: string[],
  dimension: string,
  range: DateRange,
  limit = 10
): Promise<DimensionRow[]> {
  if (projectIds.length === 0) return [];

  const { data, error } = await db
    .from('rollup_dimensions')
    .select('value, hits, visitors, revenue_cents')
    .in('project_id', projectIds)
    .eq('dimension', dimension)
    .eq('period', range.period)
    .gte('bucket', range.from.toISOString())
    .lte('bucket', range.to.toISOString());

  if (error) throw new Error(`Failed to load ${dimension}: ${error.message}`);

  // Aggregate across buckets in JS. The alternative is a SQL GROUP BY per
  // dimension via an RPC; at rollup scale (a few hundred rows) this is faster
  // than the round trip and keeps the query surface small.
  const totals = new Map<string, DimensionRow>();
  for (const row of data ?? []) {
    const existing = totals.get(row.value);
    if (existing) {
      existing.hits += row.hits;
      existing.visitors += row.visitors;
      existing.revenue_cents += row.revenue_cents;
    } else {
      totals.set(row.value, { ...(row as DimensionRow) });
    }
  }

  return [...totals.values()].sort((a, b) => b.hits - a.hits).slice(0, limit);
}

export interface RealtimeSnapshot {
  online: number;
  recentEvents: Array<{ name: string; path: string | null; country: string | null; ts: string }>;
  perMinute: number[];
}

/**
 * Realtime. The only dashboard read that touches `events`, bounded to 30
 * minutes so it stays on the (project_id, ts desc) index.
 */
export async function getRealtime(db: SupabaseClient, projectIds: string[]): Promise<RealtimeSnapshot> {
  if (projectIds.length === 0) return { online: 0, recentEvents: [], perMinute: [] };

  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from('events')
    .select('name, path, country, ts, visitor_hash')
    .in('project_id', projectIds)
    .gte('ts', since)
    .order('ts', { ascending: false })
    .limit(500);

  if (error) throw new Error(`Failed to load realtime: ${error.message}`);

  const rows = data ?? [];
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

  const online = new Set(
    rows.filter((r) => new Date(r.ts).getTime() > fiveMinutesAgo).map((r) => r.visitor_hash)
  ).size;

  // 30 one-minute buckets, oldest first.
  const perMinute = new Array(30).fill(0);
  const now = Date.now();
  for (const row of rows) {
    const age = Math.floor((now - new Date(row.ts).getTime()) / 60_000);
    if (age >= 0 && age < 30) perMinute[29 - age] += 1;
  }

  return {
    online,
    perMinute,
    recentEvents: rows.slice(0, 12).map((r) => ({
      name: r.name, path: r.path, country: r.country, ts: r.ts,
    })),
  };
}

export interface RevenueRecord {
  id: string;
  project_id: string;
  source: string;
  kind: string;
  amount_cents: number;
  currency: string;
  amount_base_cents: number;
  base_currency: string;
  occurred_at: string;
  label: string | null;
  note: string | null;
}

export async function getRevenueRecords(
  db: SupabaseClient,
  projectIds: string[],
  range: DateRange,
  limit = 100
): Promise<RevenueRecord[]> {
  if (projectIds.length === 0) return [];

  const { data, error } = await db
    .from('revenue_records')
    .select('*')
    .in('project_id', projectIds)
    .gte('occurred_at', range.from.toISOString())
    .lte('occurred_at', range.to.toISOString())
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to load revenue: ${error.message}`);
  return (data ?? []) as RevenueRecord[];
}

/**
 * MRR: the sum of the last 30 days' subscription revenue.
 *
 * A real MRR needs the subscription objects — interval, quantity, active status.
 * Pulse only stores payments, so this is a trailing-30-day proxy and is labeled
 * as such in the UI. Annual plans land entirely in the month they're billed
 * rather than being amortized, which overstates that month and understates the
 * next eleven. Calling it "MRR" without that caveat would be exactly the vanity
 * inflation Section 2 rules out.
 */
export async function getMrrProxy(db: SupabaseClient, projectIds: string[]): Promise<number> {
  if (projectIds.length === 0) return 0;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from('revenue_records')
    .select('amount_base_cents')
    .in('project_id', projectIds)
    .eq('kind', 'subscription')
    .gte('occurred_at', since);

  if (error) return 0;
  return (data ?? []).reduce((sum, r) => sum + r.amount_base_cents, 0);
}

export interface Goal {
  id: string;
  project_id: string | null;
  metric: string;
  target: number;
  label: string | null;
  show_public: boolean;
  achieved_at: string | null;
}

export async function getGoals(db: SupabaseClient): Promise<Goal[]> {
  const { data, error } = await db.from('goals').select('*').order('created_at', { ascending: true });
  if (error) return [];
  return (data ?? []) as Goal[];
}

/** Zero-fills gaps so a quiet day is a gap in the line, not a missing point. */
export function fillSeries(series: SeriesPoint[], range: DateRange): SeriesPoint[] {
  const byBucket = new Map(series.map((p) => [bucketKey(new Date(p.bucket), range.period), p]));
  const out: SeriesPoint[] = [];

  const cursor = new Date(range.from);
  const stepMs = range.period === 'hour' ? 3_600_000 : 86_400_000;

  while (cursor <= range.to) {
    const key = bucketKey(cursor, range.period);
    out.push(byBucket.get(key) ?? { ...EMPTY_TOTALS, bucket: cursor.toISOString() });
    cursor.setTime(cursor.getTime() + stepMs);
  }

  return out;
}

function bucketKey(d: Date, period: 'hour' | 'day'): string {
  return period === 'hour' ? d.toISOString().slice(0, 13) : d.toISOString().slice(0, 10);
}
