import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getProjects } from '@/lib/queries';
import { SignOutButton } from '@/components/sign-out-button';
import { NavLink } from '@/components/nav-link';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();

  // Middleware already redirects anonymous users; this is the backstop for a
  // session that expired between the middleware check and this render.
  if (!user) redirect('/login');

  const projects = await getProjects(db);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-ink-850 bg-ink-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Link href="/app" className="flex items-center gap-2 text-sm font-semibold text-ink-100">
            <svg width="22" height="22" viewBox="0 0 36 36" fill="none" aria-hidden="true">
              <path d="M7 21.5h5l2.5-8 4 13 3.5-13 2 8H29" stroke="var(--color-pulse-500)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Pulse
          </Link>

          <nav className="flex flex-1 items-center gap-1 overflow-x-auto" aria-label="Projects">
            <NavLink href="/app" exact>
              Portfolio
            </NavLink>
            {projects.map((p) => (
              <NavLink key={p.id} href={`/app/p/${p.slug}`}>
                {p.name}
              </NavLink>
            ))}
            <Link
              href="/app/new"
              className="ml-1 shrink-0 rounded-md px-2 py-1.5 text-sm text-ink-500 transition hover:bg-ink-900 hover:text-ink-200"
              title="New project"
            >
              +
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/stats" className="hidden text-xs text-ink-500 hover:text-ink-300 sm:block" target="_blank">
              Public page ↗
            </Link>
            <Link href="/app/settings" className="text-xs text-ink-500 hover:text-ink-300">
              Settings
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>

      <footer className="border-t border-ink-850 px-4 py-4">
        <p className="mx-auto max-w-7xl text-xs text-ink-700">
          Signed in as {user.email} · Data lives in your Supabase project and nowhere else.
        </p>
      </footer>
    </div>
  );
}
