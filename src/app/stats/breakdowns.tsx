import { supabasePublic } from '@/lib/supabase/server';

/**
 * Public breakdowns: top pages, sources, countries (Section 10.1).
 *
 * Each dimension is a separate pulse_public_breakdown() call, and that function
 * — not this component — decides whether the owner published it. An unpublished
 * dimension and an unknown slug both come back as an empty array, so this can
 * render whatever it gets without needing to know the toggles. A card with no
 * rows simply doesn't appear.
 */

interface MaskedNumber {
  value: number | null;
  display: string | null;
}

interface Row {
  value: string;
  hits: MaskedNumber;
  visitors: MaskedNumber;
}

const DIMENSIONS = [
  { key: 'path', title: 'Top pages' },
  { key: 'referrer', title: 'Sources' },
  { key: 'country', title: 'Countries' },
] as const;

export async function Breakdowns({ slug, days }: { slug: string; days: number }) {
  const db = supabasePublic();

  const results = await Promise.all(
    DIMENSIONS.map(async (d) => {
      const { data, error } = await db.rpc('pulse_public_breakdown', {
        p_slug: slug,
        p_dimension: d.key,
        p_days: days,
        p_limit: 8,
      });
      return { ...d, rows: error ? [] : ((data ?? []) as Row[]) };
    })
  );

  const shown = results.filter((r) => r.rows.length > 0);
  if (shown.length === 0) return null;

  return (
    <div className="grid gap-px border-t border-ink-850 bg-ink-850 sm:grid-cols-3">
      {shown.map((section) => (
        <div key={section.key} className="bg-ink-900/50 p-4">
          <h3 className="mb-2 text-xs font-medium tracking-wide text-ink-600 uppercase">
            {section.title}
          </h3>
          <List rows={section.rows} dimension={section.key} />
        </div>
      ))}
    </div>
  );
}

function List({ rows, dimension }: { rows: Row[]; dimension: string }) {
  // Bars are relative to the top row. When the style is bucketed or relative
  // there's no numeric value to scale by, so the bars are omitted rather than
  // faked — a bar chart drawn from guessed widths would leak an ordering the
  // owner chose not to publish precisely.
  const max = Math.max(...rows.map((r) => r.hits.value ?? 0), 1);
  const scalable = rows.some((r) => r.hits.value !== null);

  return (
    <ul className="space-y-1">
      {rows.map((row) => (
        <li key={row.value} className="relative">
          {scalable ? (
            <div
              className="absolute inset-y-0 left-0 rounded-sm bg-pulse-500/10"
              style={{ width: `${Math.max(((row.hits.value ?? 0) / max) * 100, 2)}%` }}
              aria-hidden="true"
            />
          ) : null}
          <div className="relative flex items-center justify-between gap-2 px-1.5 py-1">
            <span className="min-w-0 truncate text-xs text-ink-300" title={label(row.value, dimension)}>
              {label(row.value, dimension)}
            </span>
            <span className="nums shrink-0 text-xs text-ink-500">
              {row.hits.display ?? (row.hits.value !== null ? compact(row.hits.value) : '·')}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function label(value: string, dimension: string): string {
  if (dimension !== 'country') return value;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(value) ?? value;
  } catch {
    return value;
  }
}

function compact(n: number): string {
  if (n < 1000) return String(n);
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
