import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getProjectBySlug } from '@/lib/queries';
import { Card, CardHeader } from '@/components/ui';
import { Snippet } from '@/components/snippet';
import { siteOrigin } from '@/lib/site';
import { ProjectSettingsForm } from './project-settings-form';
import { PublicSettingsForm } from './public-settings-form';
import { DangerZone } from './danger-zone';
import { ExportPanel } from './export-panel';

export default async function ProjectSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await supabaseServer();

  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();

  const { data: publicSettings } = await db
    .from('project_public_settings')
    .select('*')
    .eq('project_id', project.id)
    .maybeSingle();

  const origin = await siteOrigin();

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <Card>
          <CardHeader title="Install" subtitle="Your snippet" />
          <Snippet ingestKey={project.ingest_key} origin={origin} />
        </Card>

        <Card>
          <CardHeader title="Project" />
          <ProjectSettingsForm project={project} />
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader
            title="Public page"
            subtitle={
              publicSettings?.is_public
                ? `Live at ${origin}/stats`
                : 'Not published — only you can see this data'
            }
          />
          <PublicSettingsForm projectId={project.id} settings={publicSettings ?? {}} slug={slug} origin={origin} />
        </Card>

        <Card>
          <CardHeader title="Export" subtitle="Your data, in your hands" />
          <ExportPanel slug={slug} />
        </Card>

        <Card className="border-danger-500/20">
          <CardHeader title="Danger zone" />
          <DangerZone project={project} />
        </Card>
      </div>
    </div>
  );
}
