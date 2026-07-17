'use client';

import { useRef, useState } from 'react';
import { formatMetric, type MetricFormat } from '@/lib/metrics';

/**
 * The main time-series graph.
 *
 * Hand-rolled, like everything else here — a charting library would outweigh the
 * rest of the client bundle several times over for one chart.
 *
 * Layout note, because it's the whole trick: the axes are HTML and only the plot
 * is SVG. `Sparkline` gets away with `preserveAspectRatio="none"` (stretch to
 * fill, no measuring, no resize observer) precisely because it contains no text.
 * The moment a chart has tick labels, that same stretch smears every glyph
 * horizontally. Rendering the labels as HTML around a stretched plot keeps the
 * chart fluid at any width with no JS measuring, and keeps the type undistorted.
 */

export interface ChartPoint {
  bucket: string;
  value: number;
}

const PLOT_W = 1000;
const PLOT_H = 300;

export function Chart({
  points,
  period,
  // A descriptor, not a formatter function: the page choosing the metric is a
  // server component, and React can't send a closure across that boundary.
  format: metricFormat,
  currency,
  color = 'brand',
  label,
  height = 260,
}: {
  points: ChartPoint[];
  period: 'hour' | 'day';
  format: MetricFormat;
  currency: string;
  color?: 'brand' | 'money' | 'accent';
  label: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const columns = useRef<Array<HTMLButtonElement | null>>([]);
  const format = (n: number) => formatMetric(metricFormat, n, currency);

  function onKeyDown(e: React.KeyboardEvent) {
    const last = points.length - 1;
    let next: number | null = null;

    if (e.key === 'ArrowRight') next = Math.min(focusIndex + 1, last);
    else if (e.key === 'ArrowLeft') next = Math.max(focusIndex - 1, 0);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;

    if (next !== null) {
      e.preventDefault();
      setFocusIndex(next);
      setHover(next);
      columns.current[next]?.focus();
    }
  }

  const stroke = {
    brand: 'var(--color-brand-500)',
    money: 'var(--color-money-500)',
    accent: 'var(--color-accent-500)',
  }[color];

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-text-subtle"
        style={{ height }}
      >
        No data in this range.
      </div>
    );
  }

  const values = points.map((p) => p.value);
  const peak = Math.max(...values);
  const ticks = niceTicks(peak);
  const top = ticks[ticks.length - 1];

  const step = points.length > 1 ? PLOT_W / (points.length - 1) : 0;
  const x = (i: number) => i * step;
  const y = (v: number) => PLOT_H - (v / top) * PLOT_H;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(p.value).toFixed(2)}`).join(' ');
  const area = `${line} L ${x(points.length - 1).toFixed(2)} ${PLOT_H} L 0 ${PLOT_H} Z`;
  const gradientId = `chart-fill-${color}`;

  const xLabels = pickXLabels(points, period);
  const active = hover === null ? null : points[hover];

  return (
    <div className="w-full">
      {/* pl-12 reserves the y-label gutter; the plot starts after it. */}
      <div className="relative pl-12" style={{ height }}>
        {/* Gridlines + y labels. Absolute over the full box so the plot's own
            coordinate space stays a clean 0..PLOT_H. */}
        {ticks.map((t, i) => (
          <div
            key={t}
            className="pointer-events-none absolute inset-x-0 flex items-center"
            style={{ bottom: `${(t / top) * 100}%`, height: 0 }}
          >
            <span className="nums w-12 pr-2 text-right text-[0.6875rem] text-text-subtle">
              {format(t)}
            </span>
            <div className={`h-px flex-1 ${i === 0 ? 'bg-border-strong' : 'bg-border'}`} />
          </div>
        ))}

        <div className="relative h-full">
          <svg
            viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
            role="img"
            aria-label={`${label}. ${points.length} points, peak ${format(peak)}.`}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
                <stop offset="100%" stopColor={stroke} stopOpacity="0" />
              </linearGradient>
            </defs>

            {points.length > 1 ? (
              <>
                <path d={area} fill={`url(#${gradientId})`} />
                <path
                  d={line}
                  fill="none"
                  stroke={stroke}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </>
            ) : (
              <circle cx={PLOT_W / 2} cy={y(points[0].value)} r="4" fill={stroke} />
            )}

            {active && points.length > 1 ? (
              <line
                x1={x(hover!)}
                y1="0"
                x2={x(hover!)}
                y2={PLOT_H}
                stroke={stroke}
                strokeWidth="1"
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>

          {/* The hover marker is HTML, not SVG: a circle inside the stretched
              plot would render as an ellipse. */}
          {active && points.length > 1 ? (
            <span
              className="pointer-events-none absolute z-10 block h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface"
              style={{
                left: `${(hover! / (points.length - 1)) * 100}%`,
                top: `${(y(active.value) / PLOT_H) * 100}%`,
                background: stroke,
              }}
              aria-hidden="true"
            />
          ) : null}

          {/* One transparent column per point. Columns rather than pointer math
              so the hit target is honest at any width and works on touch.

              Roving tabindex: exactly one column is tabbable and the arrows move
              between them, so the chart is a single tab stop. Making all of them
              focusable would put 366 tab stops between a keyboard user and the
              rest of the page on a 12-month range. */}
          <div className="absolute inset-0 flex" onMouseLeave={() => setHover(null)} onKeyDown={onKeyDown}>
            {points.map((p, i) => (
              <button
                key={p.bucket}
                type="button"
                ref={(el) => {
                  columns.current[i] = el;
                }}
                tabIndex={i === focusIndex ? 0 : -1}
                className="h-full flex-1 cursor-default rounded-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${formatBucket(p.bucket, period, true)}: ${format(p.value)}`}
              />
            ))}
          </div>

          {active ? (
            <div
              className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-surface px-2.5 py-1.5 shadow-lg shadow-ink-950/10"
              style={{
                left: `${clamp((hover! / Math.max(points.length - 1, 1)) * 100, 8, 92)}%`,
                top: `${Math.max((y(active.value) / PLOT_H) * 100 - 4, 0)}%`,
              }}
            >
              <div className="text-[0.6875rem] whitespace-nowrap text-text-subtle">
                {formatBucket(active.bucket, period, true)}
              </div>
              <div className="nums font-display text-sm font-bold whitespace-nowrap text-text">
                {format(active.value)}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="relative mt-2 ml-12 h-4">
        {xLabels.map(({ index, text }) => (
          <span
            key={index}
            className="absolute -translate-x-1/2 text-[0.6875rem] whitespace-nowrap text-text-subtle"
            style={{ left: `${clamp((index / Math.max(points.length - 1, 1)) * 100, 3, 97)}%` }}
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/**
 * Axis ticks a human would have picked: 0 / 2k / 4k, never 0 / 1.7k / 3.4k.
 *
 * Rounds the top of the scale up to a round number so the gridlines land on
 * values worth reading.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];

  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;

  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  const step = nice * magnitude;
  const top = Math.ceil(max / step) * step;

  const out: number[] = [];
  // Accumulated float error makes the last tick land on 5.999999…; rounding to
  // the step's own precision keeps the labels clean.
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  for (let v = 0; v <= top + step / 2; v += step) {
    out.push(Number(v.toFixed(decimals)));
  }
  return out;
}

/** Roughly six evenly spaced labels, always including the first and last. */
function pickXLabels(points: ChartPoint[], period: 'hour' | 'day'): Array<{ index: number; text: string }> {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [{ index: 0, text: formatBucket(points[0].bucket, period) }];

  const target = Math.min(6, n);
  const stride = (n - 1) / (target - 1);

  const seen = new Set<number>();
  const out: Array<{ index: number; text: string }> = [];
  for (let i = 0; i < target; i++) {
    const index = Math.round(i * stride);
    if (seen.has(index)) continue;
    seen.add(index);
    out.push({ index, text: formatBucket(points[index].bucket, period) });
  }
  return out;
}

/**
 * Formatted in UTC, deliberately.
 *
 * `fillSeries` and the rollups bucket in UTC, so formatting in the viewer's
 * local zone would slide the labels off the data they name — the last bar of a
 * "today" chart would carry tomorrow's date for anyone east of Greenwich.
 */
function formatBucket(bucket: string, period: 'hour' | 'day', long = false): string {
  const d = new Date(bucket);
  if (Number.isNaN(d.getTime())) return bucket;

  if (period === 'hour') {
    return new Intl.DateTimeFormat('en', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC',
      ...(long ? { month: 'short', day: 'numeric' } : {}),
    }).format(d);
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
    ...(long ? { year: 'numeric' } : {}),
  }).format(d);
}
