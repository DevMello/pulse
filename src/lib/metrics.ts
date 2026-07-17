import { bounceRate, avgDuration, type SeriesPoint, type Totals } from './queries';
import { formatMoneyCompact } from './money';
import { compact } from '@/components/ui';

/**
 * The dashboard's headline metrics.
 *
 * One definition per metric, used by both the tile row and the chart, so the
 * number in the tile and the line under it can't drift apart — they're the same
 * function applied to different inputs.
 */

/**
 * How a metric renders — as data, not as a closure.
 *
 * This is a descriptor rather than a `(n: number) => string` because the chart
 * is a client component and the page that picks the metric is a server one.
 * React can't serialize a function across that boundary; it throws. Sending the
 * shape of the formatting and applying it on the other side is the way through.
 */
export type MetricFormat =
  | { kind: 'compact' }
  | { kind: 'fixed'; digits: number }
  | { kind: 'percent' }
  | { kind: 'duration' }
  | { kind: 'money' };

export function formatMetric(format: MetricFormat, n: number, currency: string): string {
  switch (format.kind) {
    case 'compact':
      return compact(n);
    case 'fixed':
      return n.toFixed(format.digits);
    case 'percent':
      return `${n.toFixed(0)}%`;
    case 'duration':
      return formatDuration(n);
    case 'money':
      return formatMoneyCompact(n, currency);
  }
}

export interface MetricDef {
  key: string;
  label: string;
  hint?: string;
  accent?: 'default' | 'money';
  color: 'brand' | 'money' | 'accent';
  /** Lower is better — bounce rate's only difference from the rest. */
  invert?: boolean;
  /** The headline figure. null means "not measurable", which is not zero. */
  total: (t: Totals) => number | null;
  /** The same quantity for one bucket, for the chart. */
  point: (p: SeriesPoint) => number;
  format: MetricFormat;
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * Ratio metrics are zero on an empty bucket, not NaN.
 *
 * A gap in the chart and a genuine zero are different claims, but 0/0 rendering
 * as NaN would break the path outright — an undrawable `M NaN NaN` silently
 * blanks the whole line.
 */
function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export const METRICS: MetricDef[] = [
  {
    key: 'visitors',
    label: 'Visitors',
    // Not "unique visitors", and not by accident. sumTotals adds per-bucket
    // visitor counts, so one person visiting on Monday and Tuesday counts twice
    // over any multi-day range — see the comment on sumTotals and the public
    // methodology note. The honest word for that is visits.
    hint: 'visits, not people',
    color: 'brand',
    total: (t) => t.visitors,
    point: (p) => p.visitors,
    format: { kind: 'compact' },
  },
  {
    key: 'visits',
    label: 'Total Visits',
    hint: 'sessions',
    color: 'brand',
    total: (t) => t.sessions,
    point: (p) => p.sessions,
    format: { kind: 'compact' },
  },
  {
    key: 'pageviews',
    label: 'Pageviews',
    color: 'brand',
    total: (t) => t.pageviews,
    point: (p) => p.pageviews,
    format: { kind: 'compact' },
  },
  {
    key: 'views_per_visit',
    label: 'Views per Visit',
    color: 'accent',
    total: (t) => (t.sessions > 0 ? ratio(t.pageviews, t.sessions) : null),
    point: (p) => ratio(p.pageviews, p.sessions),
    format: { kind: 'fixed', digits: 2 },
  },
  {
    key: 'bounce_rate',
    label: 'Bounce Rate',
    hint: 'single-page visits',
    color: 'accent',
    invert: true,
    total: (t) => bounceRate(t),
    point: (p) => ratio(p.bounces, p.sessions) * 100,
    format: { kind: 'percent' },
  },
  {
    key: 'duration',
    label: 'Visit Duration',
    hint: 'engaged sessions',
    color: 'accent',
    total: (t) => avgDuration(t),
    point: (p) => ratio(p.duration_sec, p.sessions - p.bounces),
    format: { kind: 'duration' },
  },
  {
    key: 'revenue',
    label: 'Revenue',
    accent: 'money',
    color: 'money',
    total: (t) => t.revenue_cents,
    point: (p) => p.revenue_cents,
    format: { kind: 'money' },
  },
];

export function resolveMetric(key: string | undefined): MetricDef {
  return METRICS.find((m) => m.key === key) ?? METRICS[0];
}
