'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { compact } from '@/components/ui';

/**
 * A simple funnel: step A → B → C with drop-off between them.
 *
 * An honest caveat, stated in the UI rather than buried here: these are event
 * *counts* from the rollups, not per-visitor paths. So "40% reached step 2"
 * means step 2 fired 40% as often as step 1 — not that 40% of the specific
 * people who did step 1 went on to do step 2.
 *
 * A true per-visitor funnel means sequencing raw events per visitor_hash, which
 * only works inside the retention window and costs a firehose scan per view.
 * For the "visits → signups → purchases" question this product is actually for,
 * the ratio is the answer, and it stays correct after raw events are pruned.
 * Overstating what it measures would be the kind of vanity metric Section 2
 * rules out.
 */
export function Funnel({
  available,
  selected,
  counts,
  visitors,
}: {
  available: string[];
  selected: string[];
  counts: Record<string, number>;
  visitors: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setSteps(next: string[]) {
    const q = new URLSearchParams(params);
    if (next.length > 0) q.set('steps', next.join(','));
    else q.delete('steps');
    router.push(`${pathname}?${q}`);
  }

  if (available.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-600">
        Track a couple of custom events and you can build a funnel here.
      </p>
    );
  }

  const steps = selected.filter((s) => s in counts);
  // "Visitors" as an implicit first step is what makes the funnel answer the
  // question people actually have: what fraction of traffic converts?
  const rows = [{ label: 'Visitors', value: visitors, implicit: true }, ...steps.map((s) => ({ label: s, value: counts[s] ?? 0, implicit: false }))];
  const top = rows[0]?.value || 1;

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 border-b border-ink-850 px-4 py-3">
        {available.map((name) => {
          const active = steps.includes(name);
          return (
            <button
              key={name}
              type="button"
              onClick={() => setSteps(active ? steps.filter((s) => s !== name) : [...steps, name])}
              className={`rounded-md border px-2 py-1 text-xs transition ${
                active
                  ? 'border-pulse-600/50 bg-pulse-600/15 text-pulse-400'
                  : 'border-ink-800 bg-ink-850 text-ink-500 hover:text-ink-200'
              }`}
            >
              {active ? `${steps.indexOf(name) + 1}. ` : '+ '}
              {name}
            </button>
          );
        })}
        {steps.length > 0 ? (
          <button type="button" onClick={() => setSteps([])} className="ml-auto text-xs text-ink-600 hover:text-ink-300">
            Clear
          </button>
        ) : null}
      </div>

      {steps.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-ink-600">
          Click events above, in order, to build a funnel.
        </p>
      ) : (
        <>
          <div className="space-y-2 p-4">
            {rows.map((row, i) => {
              const prev = i > 0 ? rows[i - 1].value : null;
              const conversion = prev && prev > 0 ? (row.value / prev) * 100 : null;
              const width = Math.max((row.value / top) * 100, 1.5);

              return (
                <div key={row.label}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                    <span className={row.implicit ? 'text-ink-500' : 'text-ink-300'}>{row.label}</span>
                    <span className="nums text-ink-400">
                      {compact(row.value)}
                      {conversion !== null ? (
                        <span className={`ml-2 ${conversion < 10 ? 'text-danger-400' : 'text-pulse-400'}`}>
                          {conversion.toFixed(1)}%
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="h-6 overflow-hidden rounded bg-ink-850">
                    <div
                      className={`h-full rounded transition-all ${row.implicit ? 'bg-ink-700' : 'bg-pulse-500/70'}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <p className="border-t border-ink-850 px-4 py-2.5 text-xs leading-relaxed text-ink-600">
            Ratios compare event counts between steps, not the paths of individual visitors — Pulse
            stores no per-person history to follow.
          </p>
        </>
      )}
    </div>
  );
}
