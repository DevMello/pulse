import { WORLD_PATHS, WORLD_UNKEYED_PATHS, WORLD_VIEWBOX } from '@/lib/geo/world-map-paths';
import { compact } from '@/components/ui';

/**
 * Countries choropleth.
 *
 * A server component with no client JS: the hover readout is a native <title>,
 * which every browser and screen reader already knows how to surface. A
 * JS tooltip would look nicer and cost a hydration boundary plus ~20KB of
 * geometry crossing into the client bundle to achieve it.
 */

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Traffic is power-law: one country is usually an order of magnitude ahead of
 * the rest. A linear ramp would paint the leader solid and everything else
 * indistinguishable from empty, which is the failure mode that makes most
 * choropleths useless. Square root compresses the top and lifts the tail.
 *
 * The 0.15 floor keeps a country with a single visit visibly distinct from one
 * with none — that distinction is the entire question the map answers.
 */
function intensity(value: number, max: number): number {
  if (max <= 0) return 0;
  return 0.15 + 0.85 * Math.sqrt(value / max);
}

export function WorldMap({
  rows,
  valueLabel = 'pageviews',
}: {
  rows: Array<{ value: string; hits: number }>;
  valueLabel?: string;
}) {
  const byCode = new Map(rows.map((r) => [r.value.toUpperCase(), r.hits]));
  const max = Math.max(...rows.map((r) => r.hits), 0);

  // Codes with traffic that the geometry has no shape for — chiefly small
  // island territories Natural Earth's 110m set drops. Surfaced rather than
  // silently swallowed: a visitor who doesn't appear anywhere on the map is
  // exactly the kind of quiet data loss this codebase keeps getting bitten by.
  const unmapped = rows.filter((r) => !WORLD_PATHS[r.value.toUpperCase()]);

  return (
    <div className="px-4 py-3">
      <svg
        viewBox={WORLD_VIEWBOX}
        className="h-auto w-full"
        role="img"
        aria-label={
          rows.length === 0
            ? 'World map, no traffic in this range.'
            : `World map of ${valueLabel} by country. ${rows.length} countries with traffic, led by ${countryName(rows[0].value)}.`
        }
      >
        {WORLD_UNKEYED_PATHS.map((d, i) => (
          <path key={`u${i}`} d={d} className="fill-map-empty stroke-surface" strokeWidth="1" />
        ))}

        {Object.entries(WORLD_PATHS).map(([code, d]) => {
          const hits = byCode.get(code);
          return (
            <path
              key={code}
              d={d}
              className={hits ? 'fill-brand-500 stroke-surface' : 'fill-map-empty stroke-surface'}
              fillOpacity={hits ? intensity(hits, max) : 1}
              strokeWidth="1"
            >
              {hits ? (
                <title>{`${countryName(code)}: ${compact(hits)} ${valueLabel}`}</title>
              ) : null}
            </path>
          );
        })}
      </svg>

      {rows.length > 0 ? (
        <div className="mt-2 flex items-center justify-end gap-2">
          <span className="text-[0.6875rem] text-text-subtle">Less</span>
          {[0.15, 0.35, 0.55, 0.75, 1].map((o) => (
            <span key={o} className="h-2.5 w-5 rounded-sm bg-brand-500" style={{ opacity: o }} aria-hidden="true" />
          ))}
          <span className="text-[0.6875rem] text-text-subtle">
            More · peak {compact(max)}
          </span>
        </div>
      ) : null}

      {unmapped.length > 0 ? (
        <p className="mt-2 text-[0.6875rem] text-text-subtle">
          Not on this map: {unmapped.map((r) => `${countryName(r.value)} (${compact(r.hits)})`).join(', ')}
          {' — '}the 1:110m geometry omits some small territories.
        </p>
      ) : null}
    </div>
  );
}
