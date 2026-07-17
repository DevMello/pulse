'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLink({
  href,
  children,
  exact = false,
}: {
  href: string;
  children: React.ReactNode;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`shrink-0 rounded-md px-2.5 py-1.5 text-sm transition ${
        active ? 'bg-ink-850 text-ink-50' : 'text-ink-500 hover:bg-ink-900 hover:text-ink-200'
      }`}
    >
      {children}
    </Link>
  );
}
