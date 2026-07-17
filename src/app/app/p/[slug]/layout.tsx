import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getProjectBySlug } from '@/lib/queries';
import { NavLink } from '@/components/nav-link';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const db = await supabaseServer();
  const project = await getProjectBySlug(db, slug);

  // RLS already scopes this query to the owner, so "not yours" and "not real"
  // both arrive here as null — and both should look identical from outside.
  if (!project) notFound();

  const base = `/app/p/${slug}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-ink-50">{project.name}</h1>
          <p className="truncate text-sm text-ink-600">
            {project.domains.length > 0 ? project.domains.join(', ') : 'No domain restriction'}
            {project.archived ? ' · archived' : ''}
          </p>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-ink-850 pb-px" aria-label="Project sections">
        <NavLink href={base} exact>Overview</NavLink>
        <NavLink href={`${base}/traffic`}>Traffic</NavLink>
        <NavLink href={`${base}/events`}>Events</NavLink>
        <NavLink href={`${base}/revenue`}>Revenue</NavLink>
        <NavLink href={`${base}/realtime`}>Realtime</NavLink>
        <NavLink href={`${base}/settings`}>Settings</NavLink>
      </nav>

      {children}
    </div>
  );
}
