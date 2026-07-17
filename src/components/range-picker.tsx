'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: '12mo', label: '12 months' },
] as const;

/**
 * `tone="onBrand"` is for the picker sitting on the gradient panel.
 *
 * Inactive pills are solid white text, not white/75. The gradient is held dark
 * enough that full white clears AA on it (4.8:1 at its lightest), but a 75% tint
 * drops to 3.9 and fails — there is no headroom to dim text on this surface.
 */
export function RangePicker({ current, tone = 'default' }: { current: string; tone?: 'default' | 'onBrand' }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function select(key: string) {
    // Copied, not replaced: the chart's ?metric= selection lives in here too and
    // must survive a range change.
    const next = new URLSearchParams(params);
    next.set('range', key);
    router.push(`${pathname}?${next}`);
  }

  const onBrand = tone === 'onBrand';

  return (
    <div
      className={`inline-flex gap-1 rounded-full p-1 ${
        onBrand ? 'bg-white/15' : 'border border-border bg-surface'
      }`}
      role="group"
      aria-label="Date range"
    >
      {PRESETS.map((p) => {
        const active = current === p.key;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => select(p.key)}
            aria-pressed={active}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              onBrand
                ? active
                  ? 'bg-white text-brand-700 shadow-sm'
                  : 'text-white hover:bg-white/15'
                : active
                  ? 'bg-brand-500 text-white shadow-sm'
                  : 'text-text-subtle hover:text-text'
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
