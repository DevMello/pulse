import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * Shared primitives for the dashboard and the public page.
 *
 * Deliberately plain: no component library, no chart library. The charts here
 * are hand-rolled SVG because a charting dependency would outweigh the entire
 * rest of the client bundle, and the public page's whole promise is that it
 * loads instantly and costs nothing to serve.
 *
 * Everything structural references the semantic tokens (surface / border /
 * text), never the raw ink-* ramp — see globals.css for why.
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
    <Tag className={`rounded-2xl border border-border bg-surface shadow-sm shadow-ink-950/[0.03] ${className}`}>
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="truncate font-display text-sm font-semibold text-text">{title}</h2>
        {subtitle ? <p className="mt-0.5 truncate text-xs text-text-subtle">{subtitle}</p> : null}
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
        <span className="text-xs font-medium tracking-wide text-text-subtle uppercase">{label}</span>
        {delta === undefined ? null : <Delta value={delta} />}
      </div>
      <div
        className={`nums mt-1.5 font-display text-2xl font-bold ${
          accent === 'money' ? 'text-money-700' : 'text-text'
        }`}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-text-subtle">{hint}</div> : null}
    </div>
  );
}

/**
 * A selectable headline number.
 *
 * The tile row doubles as the chart's metric picker, so each tile is a link that
 * sets `?metric=`. A link rather than a button: the selection is part of the
 * page's address, so it survives a reload and can be shared, and the chart stays
 * server-rendered instead of needing client state to redraw.
 */
export function MetricTile({
  label,
  value,
  delta,
  hint,
  href,
  selected,
  accent = 'default',
  invert = false,
}: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  hint?: string;
  href: string;
  selected: boolean;
  accent?: 'default' | 'money';
  invert?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={selected ? 'true' : undefined}
      className={`group relative block rounded-xl px-3 py-3 transition ${
        selected ? 'bg-brand-50' : 'hover:bg-surface-sunken'
      }`}
    >
      {/* The selected tile carries a bar as well as a fill, so the choice
          survives a grayscale print and a color-vision difference. */}
      <span
        aria-hidden="true"
        className={`absolute inset-x-3 top-0 h-0.5 rounded-full transition ${
          selected ? 'bg-brand-500' : 'bg-transparent'
        }`}
      />
      {/* The label owns its line. Sharing it with the delta wrapped every
          two-word metric at seven-across. */}
      <div className="truncate text-[0.625rem] font-semibold tracking-wide text-text-subtle uppercase" title={label}>
        {label}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
        <span
          className={`nums font-display text-lg font-bold ${
            accent === 'money' ? 'text-money-700' : 'text-text'
          }`}
        >
          {value}
        </span>
        {delta === undefined ? null : <Delta value={delta} invert={invert} />}
      </div>
      {hint ? (
        <div className="mt-0.5 truncate text-[0.625rem] text-text-subtle" title={hint}>
          {hint}
        </div>
      ) : null}
    </Link>
  );
}

/**
 * Percentage change.
 *
 * null means "no previous data to compare against", which is different from 0%
 * and must not be rendered as +∞% or as a flat line — both would be lies.
 *
 * There is deliberately no on-gradient variant. An earlier cut had one, using
 * pale tints so the arrows would read on the brand panel; the contrast math says
 * that's unachievable — white itself only manages ~5:1 on a mid-tone gradient,
 * so any *tint* of it is worse, and these arrows are 12px. Small colored text
 * belongs on a light card. See the note on .brand-panel.
 */
export function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null || value === undefined) {
    return <span className="text-xs text-text-subtle">new</span>;
  }

  const flat = Math.abs(value) < 0.05;
  const good = invert ? value < 0 : value > 0;

  const tone = flat ? 'text-text-subtle' : good ? 'text-positive-600' : 'text-danger-600';

  const arrow = flat ? '→' : value > 0 ? '↑' : '↓';
  const magnitude = Math.abs(value);

  // A tenth of a percent is meaningful at 3%; at 240% it's noise dressed up as
  // precision, and it's the difference between the delta fitting next to the
  // number and wrapping under it.
  const shown = flat ? '0%' : `${magnitude >= 100 ? magnitude.toFixed(0) : magnitude.toFixed(1)}%`;

  return (
    <span className={`nums shrink-0 text-xs font-semibold whitespace-nowrap ${tone}`} title="vs. previous period">
      {arrow} {shown}
    </span>
  );
}

/**
 * Sparkline / area chart.
 *
 * Pure SVG with a viewBox, so it scales to any container without JS and without
 * a resize observer. Text-free by design — `preserveAspectRatio="none"` stretches
 * the drawing to fill its box, which would deform any glyph inside it. The big
 * chart with axes is a separate component for exactly that reason.
 */
export function Sparkline({
  points,
  height = 48,
  className = '',
  stroke = 'var(--color-brand-500)',
  fill = 'var(--color-brand-500)',
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
    return <p className="px-4 py-6 text-center text-sm text-text-subtle">{emptyMessage}</p>;
  }

  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.label} className="relative">
          {/* The bar is a background layer so the label stays readable at any
              width instead of being pushed around by the bar's length. */}
          <div
            className="absolute inset-y-0 left-0 rounded-r bg-brand-500/10"
            style={{ width: `${Math.max((item.value / max) * 100, 1.5)}%` }}
            aria-hidden="true"
          />
          <div className="relative flex items-center justify-between gap-3 px-4 py-2">
            <span className="flex min-w-0 items-center gap-2 text-sm text-text" title={item.label}>
              {item.href ? (
                <a
                  href={item.href}
                  className="truncate hover:text-brand-600 hover:underline"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {item.label}
                </a>
              ) : (
                <span className="truncate">{item.label}</span>
              )}
            </span>
            <span className="nums shrink-0 text-sm font-medium text-text-subtle" title={`${item.value} ${valueLabel}`}>
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
      <p className="text-sm font-medium text-text">{title}</p>
      {children ? <div className="mx-auto mt-2 max-w-md text-sm text-text-subtle">{children}</div> : null}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' }) {
  const tones = {
    neutral: 'border-border-strong bg-surface-sunken text-text-muted',
    good: 'border-positive-600/30 bg-positive-500/10 text-positive-700',
    warn: 'border-warn-600/30 bg-warn-500/10 text-warn-700',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/**
 * The product mark. Previously duplicated in the dashboard header and the login
 * page, which had already drifted apart by a stroke width.
 */
export function PulseMark({ size = 22, boxed = false }: { size?: number; boxed?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
      {boxed ? (
        <rect x="0.5" y="0.5" width="35" height="35" rx="9" className="fill-brand-50 stroke-brand-200" />
      ) : null}
      <path
        d="M7 21.5h5l2.5-8 4 13 3.5-13 2 8H29"
        stroke="var(--color-brand-500)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
