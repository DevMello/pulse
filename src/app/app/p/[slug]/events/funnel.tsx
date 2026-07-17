'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { compact } from '@/components/ui';

/**
 * A per-visitor funnel: step A → B → C with drop-off between them.
 *
 * The numbers are people, not fires: pulse_owner_funnel walks raw events one
 * visitor_hash at a time, so "40% reached step 2" means 40% of the visitors
 * who did step 1 went on to do step 2 — after step 1, in order. An event that
 * fires twice for one person counts once.
 *
 * The two limits that sequencing raw events inherits, both stated in the UI:
 * only events inside the retention window still exist to be walked, and the
 * visitor hash rotates at UTC midnight (the privacy design), so a conversion
 * spanning two days counts as a drop-off rather than being linked.
 */
export function Funnel({
  available,
  selected,
  stepVisitors,
  visitors,
  beyondRetention,
  retentionDays,
}: {
  available: string[];
  selected: string[];
  /** Visitors who completed each selected step in order, keyed by step name. */
  stepVisitors: Record<string, number>;
  /** Distinct visitors over the range — the implicit first step. */
  visitors: number;
  /** True when the selected range reaches past the raw-event retention window. */
  beyondRetention: boolean;
  retentionDays: number;
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
      <p className="px-4 py-8 text-center text-sm text-text-subtle">
        Track a couple of custom events and you can build a funnel here.
      </p>
    );
  }

  const steps = selected.filter((s) => available.includes(s));
  // "Visitors" as an implicit first step is what makes the funnel answer the
  // question people actually have: what fraction of traffic converts?
  const rows = [{ label: 'Visitors', value: visitors, implicit: true }, ...steps.map((s) => ({ label: s, value: stepVisitors[s] ?? 0, implicit: false }))];
  const top = rows[0]?.value || 1;

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-3">
        {available.map((name) => {
          const active = steps.includes(name);
          return (
            <button
              key={name}
              type="button"
              onClick={() => setSteps(active ? steps.filter((s) => s !== name) : [...steps, name])}
              className={`rounded-md border px-2 py-1 text-xs transition ${
                active
                  ? 'border-brand-500/40 bg-brand-500/10 text-brand-700'
                  : 'border-border-strong bg-surface-sunken text-text-subtle hover:text-text'
              }`}
            >
              {active ? `${steps.indexOf(name) + 1}. ` : '+ '}
              {name}
            </button>
          );
        })}
        {steps.length > 0 ? (
          <button type="button" onClick={() => setSteps([])} className="ml-auto text-xs text-text-subtle hover:text-text">
            Clear
          </button>
        ) : null}
      </div>

      {steps.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-text-subtle">
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
                    <span className={row.implicit ? 'text-text-subtle' : 'text-text'}>{row.label}</span>
                    <span className="nums text-text-muted">
                      {compact(row.value)}
                      {conversion !== null ? (
                        <span className={`ml-2 ${conversion < 10 ? 'text-danger-600' : 'text-positive-600'}`}>
                          {conversion.toFixed(1)}%
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="h-6 overflow-hidden rounded bg-surface-sunken">
                    <div
                      className={`h-full rounded transition-all ${row.implicit ? 'bg-ink-300' : 'bg-brand-500/70'}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <p className="border-t border-border px-4 py-2.5 text-xs leading-relaxed text-text-subtle">
            Counts visitors who completed the steps in order, each person once. Visitor identity
            resets at UTC midnight by design, so a conversion spread across two days shows as a
            drop-off.
            {beyondRetention
              ? ` This range reaches past the ${retentionDays}-day raw-event retention window; pruned events can't be counted.`
              : null}
          </p>
        </>
      )}
    </div>
  );
}
