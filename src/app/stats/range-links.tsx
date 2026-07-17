import Link from 'next/link';

// 30 is the canonical /stats page; the rest are /stats/[days].
const RANGES = [
  { days: 7, label: '7 days', href: '/stats/7' },
  { days: 30, label: '30 days', href: '/stats' },
  { days: 90, label: '90 days', href: '/stats/90' },
  { days: 365, label: '1 year', href: '/stats/365' },
];

/**
 * Range switcher as plain links, not a client component.
 *
 * Each range is its own statically-generated URL, so switching hits the CDN
 * instead of the database — and the page still works with JavaScript disabled.
 */
export function RangeLinks({ current }: { current: number }) {
  return (
    <nav className="flex gap-1" aria-label="Date range">
      {RANGES.map((r) => (
        <Link
          key={r.days}
          href={r.href}
          aria-current={current === r.days ? 'page' : undefined}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            current === r.days
              ? 'bg-surface-sunken text-text'
              : 'text-text-subtle hover:bg-surface hover:text-text'
          }`}
        >
          {r.label}
        </Link>
      ))}
    </nav>
  );
}
