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
      className={`shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium transition ${
        active ? 'bg-brand-50 text-brand-700' : 'text-text-subtle hover:bg-surface-sunken hover:text-text'
      }`}
    >
      {children}
    </Link>
  );
}
