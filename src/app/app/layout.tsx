import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getProjects } from '@/lib/queries';
import { SignOutButton } from '@/components/sign-out-button';
import { NavLink } from '@/components/nav-link';
import { ThemeToggle } from '@/components/theme-toggle';
import { PulseMark } from '@/components/ui';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();

  // Middleware already redirects anonymous users; this is the backstop for a
  // session that expired between the middleware check and this render.
  if (!user) redirect('/login');

  const projects = await getProjects(db);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Link href="/app" className="flex items-center gap-2 font-display text-sm font-bold text-text">
            <PulseMark />
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
              className="ml-1 shrink-0 rounded-lg px-2 py-1.5 text-sm text-text-subtle transition hover:bg-surface-sunken hover:text-text"
              title="New project"
            >
              +
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/stats" className="hidden text-xs text-text-subtle hover:text-text sm:block" target="_blank">
              Public page ↗
            </Link>
            <Link href="/app/settings" className="text-xs text-text-subtle hover:text-text">
              Settings
            </Link>
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>

      <footer className="border-t border-border px-4 py-4">
        <p className="mx-auto max-w-7xl text-xs text-text-subtle">
          Signed in as {user.email} · Data lives in your Supabase project and nowhere else.
        </p>
      </footer>
    </div>
  );
}
