import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getProjectBySlug } from '@/lib/queries';
import { RealtimeView } from './realtime-view';

export default async function RealtimePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await supabaseServer();
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();

  return <RealtimeView projectId={project.id} />;
}
