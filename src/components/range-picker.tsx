'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: '12mo', label: '12mo' },
] as const;

export function RangePicker({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function select(key: string) {
    const next = new URLSearchParams(params);
    next.set('range', key);
    router.push(`${pathname}?${next}`);
  }

  return (
    <div className="inline-flex rounded-lg border border-ink-850 bg-ink-900 p-0.5" role="group" aria-label="Date range">
      {PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => select(p.key)}
          aria-pressed={current === p.key}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            current === p.key ? 'bg-ink-800 text-ink-50' : 'text-ink-500 hover:text-ink-200'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
