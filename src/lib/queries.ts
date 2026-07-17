import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Dashboard reads.
 *
 * Everything here goes through `rollups` / `rollup_dimensions`, never `events` —
 * that is the whole reason the rollup tables exist (Section 7). Realtime is the
 * one exception and lives in the client component that needs it.
 *
 * Aggregation happens in Postgres via the pulse_owner_* functions, not in JS.
 * PostgREST caps every response at 1000 rows, so summing fetched rows here
 * silently truncated past that and produced wrong numbers with no error.
 *
 * Every function runs under the owner's session, so RLS scopes the rows. The
 * project_id filters are for correctness, not security.
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

/**
 * Rollup series for the given projects and window.
 *
 * Aggregated by Postgres, not here. Selecting the raw rows and summing them in
 * JS silently truncates: PostgREST caps every response at 1000 rows, so a
 * 12-month range across three projects (365 x 3 = 1095 rows) would drop the
 * overflow and report a wrong total with no error. Grouping in SQL returns one
 * row per bucket — at most 366 — and never approaches the cap.
 *
 * The RPC is security invoker, so RLS still scopes it to the owner's projects.
 */
export async function getSeries(
  db: SupabaseClient,
  projectIds: string[],
  range: DateRange
): Promise<SeriesPoint[]> {
  if (projectIds.length === 0) return [];

  const { data, error } = await db.rpc('pulse_owner_series', {
    p_project_ids: projectIds,
    p_period: range.period,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  });

  if (error) throw new Error(`Failed to load series: ${error.message}`);

  return (data ?? []).map((row: Record<string, number | string>) => ({
    bucket: String(row.bucket),
    pageviews: Number(row.pageviews),
    visitors: Number(row.visitors),
    sessions: Number(row.sessions),
    bounces: Number(row.bounces),
    duration_sec: Number(row.duration_sec),
    events: Number(row.events),
    revenue_cents: Number(row.revenue_cents),
  }));
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

/**
 * Top values for a dimension.
 *
 * Grouped and limited by Postgres. Doing it here meant fetching every matching
 * rollup_dimensions row first, which PostgREST truncates at 1000 — on 60 days
 * of demo data that table already held 65k rows, so a top-pages list was being
 * computed from an arbitrary 1000-row slice and was simply wrong. Ranking has
 * to happen where all the rows are.
 */
export async function getBreakdown(
  db: SupabaseClient,
  projectIds: string[],
  dimension: string,
  range: DateRange,
  limit = 10
): Promise<DimensionRow[]> {
  if (projectIds.length === 0) return [];

  const { data, error } = await db.rpc('pulse_owner_breakdown', {
    p_project_ids: projectIds,
    p_dimension: dimension,
    p_period: range.period,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
    p_limit: limit,
  });

  if (error) throw new Error(`Failed to load ${dimension}: ${error.message}`);

  return (data ?? []).map((row: Record<string, number | string>) => ({
    value: String(row.value),
    hits: Number(row.hits),
    visitors: Number(row.visitors),
    revenue_cents: Number(row.revenue_cents),
  }));
}

export interface FunnelResult {
  /** Distinct visitors over the range — the funnel's implicit top step. */
  visitors: number;
  /** Visitors who completed the steps in order, aligned with the input array. */
  steps: number[];
}

/**
 * Per-person funnel: how many visitors completed the steps *in order*.
 *
 * This is the one dashboard read that goes to raw `events` instead of rollups,
 * because sequencing needs per-visitor order and rollups deliberately store
 * none. Two limits follow and are surfaced in the UI rather than hidden:
 * events outside the retention window no longer exist to be walked, and
 * visitor identity resets at UTC midnight, so a conversion spanning two days
 * counts as a drop-off. Within those limits the counts are people, not fires.
 */
export async function getFunnel(
  db: SupabaseClient,
  projectIds: string[],
  steps: string[],
  range: DateRange
): Promise<FunnelResult> {
  if (projectIds.length === 0 || steps.length === 0) return { visitors: 0, steps: [] };

  const { data, error } = await db.rpc('pulse_owner_funnel', {
    p_project_ids: projectIds,
    p_steps: steps,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  });

  if (error) throw new Error(`Failed to load funnel: ${error.message}`);

  const byStep = new Map<number, number>(
    (data ?? []).map((row: { step: number; visitors: number }) => [Number(row.step), Number(row.visitors)])
  );
  return {
    visitors: byStep.get(0) ?? 0,
    steps: steps.map((_, i) => byStep.get(i + 1) ?? 0),
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
 * MRR: the monthly run rate of currently-paid-for subscriptions.
 *
 * Each subscription payment carries the billing interval it covers, and the SQL
 * normalizes: a $120 annual payment contributes $10 for each of the twelve
 * months it spans and drops out when the paid year ends, instead of landing as
 * one spike in its billing month. Rows without an interval (manual entries,
 * pre-migration data) are treated as monthly, which reproduces the old
 * trailing-30-day behavior for exactly those rows.
 *
 * Still computed from payments rather than subscription objects, so a canceled
 * plan keeps counting until its paid period lapses — the remaining
 * approximation, and it errs toward money actually received.
 */
export async function getMrr(db: SupabaseClient, projectIds: string[]): Promise<number> {
  if (projectIds.length === 0) return 0;

  // Summed in SQL: fetching the rows and adding them up here would truncate at
  // the 1000-row response cap and understate MRR for anyone with a real
  // subscription base.
  const { data, error } = await db.rpc('pulse_owner_mrr', { p_project_ids: projectIds });

  if (error) return 0;
  return Number(data ?? 0);
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
