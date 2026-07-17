import type { ReactNode } from 'react';

/**
 * Shared primitives for the dashboard and the public page.
 *
 * Deliberately plain: no component library, no chart library. The charts here
 * are hand-rolled SVG because a charting dependency would outweigh the entire
 * rest of the client bundle, and the public page's whole promise is that it
 * loads instantly and costs nothing to serve.
 */

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
}) {
  return (
    <Tag className={`rounded-xl border border-ink-850 bg-ink-900/60 ${className}`}>{children}</Tag>
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink-850 px-4 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-medium text-ink-200">{title}</h2>
        {subtitle ? <p className="mt-0.5 truncate text-xs text-ink-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** A headline number with its trend. */
export function Stat({
  label,
  value,
  delta,
  hint,
  accent = 'default',
}: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  hint?: string;
  accent?: 'default' | 'money';
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-ink-500 uppercase">{label}</span>
        {delta === undefined ? null : <Delta value={delta} />}
      </div>
      <div
        className={`nums mt-1.5 text-2xl font-semibold ${
          accent === 'money' ? 'text-money-400' : 'text-ink-50'
        }`}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-ink-600">{hint}</div> : null}
    </div>
  );
}

/**
 * Percentage change.
 *
 * null means "no previous data to compare against", which is different from 0%
 * and must not be rendered as +∞% or as a flat line — both would be lies.
 */
export function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null || value === undefined) {
    return <span className="text-xs text-ink-600">new</span>;
  }

  const flat = Math.abs(value) < 0.05;
  const good = invert ? value < 0 : value > 0;
  const tone = flat ? 'text-ink-500' : good ? 'text-pulse-400' : 'text-danger-400';
  const arrow = flat ? '→' : value > 0 ? '↑' : '↓';

  return (
    <span className={`nums text-xs font-medium ${tone}`} title="vs. previous period">
      {arrow} {flat ? '0%' : `${Math.abs(value).toFixed(1)}%`}
    </span>
  );
}

/**
 * Sparkline / area chart.
 *
 * Pure SVG with a viewBox, so it scales to any container without JS and without
 * a resize observer.
 */
export function Sparkline({
  points,
  height = 48,
  className = '',
  stroke = 'var(--color-pulse-500)',
  fill = 'var(--color-pulse-500)',
  label,
}: {
  points: number[];
  height?: number;
  className?: string;
  stroke?: string;
  fill?: string;
  label?: string;
}) {
  if (points.length === 0) {
    return <div className={`h-12 ${className}`} role="img" aria-label={label ?? 'No data'} />;
  }

  const width = 300;
  const max = Math.max(...points, 1);
  // A single point has no line to draw; render it centered rather than dividing
  // by zero.
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  const y = (v: number) => height - (v / max) * (height - 4) - 2;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(2)} ${y(p).toFixed(2)}`).join(' ');
  const area = `${line} L ${((points.length - 1) * step).toFixed(2)} ${height} L 0 ${height} Z`;
  const id = `spark-${Math.abs(hashPoints(points))}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`w-full ${className}`}
      style={{ height }}
      role="img"
      aria-label={label ?? `Trend, ${points.length} points, peak ${max}`}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity="0.28" />
          <stop offset="100%" stopColor={fill} stopOpacity="0" />
        </linearGradient>
      </defs>
      {points.length > 1 ? <path d={area} fill={`url(#${id})`} /> : null}
      {points.length > 1 ? (
        <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      ) : (
        <circle cx={width / 2} cy={y(points[0])} r="2" fill={stroke} />
      )}
    </svg>
  );
}

function hashPoints(points: number[]): number {
  let h = 0;
  for (const p of points) h = (h * 31 + p) | 0;
  return h;
}

/** Horizontal bar list — the top-pages/sources/countries shape. */
export function BarList({
  items,
  valueLabel = 'views',
  emptyMessage = 'Nothing yet.',
  formatValue,
}: {
  items: Array<{ label: string; value: number; display?: string | null; href?: string }>;
  valueLabel?: string;
  emptyMessage?: string;
  formatValue?: (n: number) => string;
}) {
  if (items.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-ink-600">{emptyMessage}</p>;
  }

  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <ul className="divide-y divide-ink-850/60">
      {items.map((item) => (
        <li key={item.label} className="relative">
          {/* The bar is a background layer so the label stays readable at any
              width instead of being pushed around by the bar's length. */}
          <div
            className="absolute inset-y-0 left-0 bg-pulse-500/10"
            style={{ width: `${Math.max((item.value / max) * 100, 1.5)}%` }}
            aria-hidden="true"
          />
          <div className="relative flex items-center justify-between gap-3 px-4 py-2">
            <span className="min-w-0 truncate text-sm text-ink-300" title={item.label}>
              {item.href ? (
                <a href={item.href} className="hover:text-ink-100 hover:underline" target="_blank" rel="noreferrer noopener">
                  {item.label}
                </a>
              ) : (
                item.label
              )}
            </span>
            <span className="nums shrink-0 text-sm text-ink-400" title={`${item.value} ${valueLabel}`}>
              {item.display ?? (formatValue ? formatValue(item.value) : compact(item.value))}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function compact(n: number): string {
  if (Math.abs(n) < 1000) return String(n);
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm font-medium text-ink-300">{title}</p>
      {children ? <div className="mx-auto mt-2 max-w-md text-sm text-ink-600">{children}</div> : null}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' }) {
  const tones = {
    neutral: 'border-ink-800 bg-ink-850 text-ink-400',
    good: 'border-pulse-600/40 bg-pulse-600/10 text-pulse-400',
    warn: 'border-money-500/40 bg-money-500/10 text-money-400',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
