import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase/server';
import { getProjects, getGoals } from '@/lib/queries';
import { Card, CardHeader, Badge } from '@/components/ui';
import { CodeBlock } from '@/components/snippet';
import { siteOrigin } from '@/lib/site';
import { OwnerProfileForm } from './owner-profile-form';
import { StripeMappings } from './stripe-mappings';
import { GoalsPanel } from './goals-panel';
import { ConnectedApps, type ConnectedApp } from './connected-apps';
import { displayCurrency } from '@/lib/money';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();

  const [projects, goals, origin] = await Promise.all([getProjects(db), getGoals(db), siteOrigin()]);

  const { data: owner } = await db.from('owners').select('*').eq('id', user!.id).maybeSingle();
  const { data: mappings } = await db
    .from('revenue_mappings')
    .select('id, project_id, match_type, match_value')
    .eq('source', 'stripe');

  const stripeReady = Boolean(process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_SECRET_KEY);

  // `?? true` matches the column default, so the panel reads correctly in the
  // window between deploying this and running the 20260101001000 migration.
  const mcpOn = (owner?.mcp_enabled as boolean | undefined) ?? true;
  const mcpConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  /**
   * Live MCP grants. Read through the owner's session, so RLS filters to their
   * own rows; the client name is joined from mcp_clients, which is readable
   * only for clients they have actually granted.
   *
   * Errors are swallowed to null because this table only exists after the
   * 20260101000900 migration. A fork that has not run it should see an empty
   * panel, not a settings page that 500s.
   */
  const { data: connected } = await db
    .from('mcp_authorizations')
    .select('id, scope, created_at, last_used_at, mcp_clients!inner(client_name)')
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  const apps: ConnectedApp[] = (connected ?? []).map((row) => ({
    id: row.id as string,
    scope: row.scope as string,
    created_at: row.created_at as string,
    last_used_at: (row.last_used_at as string | null) ?? null,
    client_name:
      (row.mcp_clients as unknown as { client_name: string } | null)?.client_name ?? 'Unknown app',
  }));

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-text">Settings</h1>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Public page" subtitle={`${origin}/stats`} />
          <OwnerProfileForm owner={owner ?? {}} />
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Stripe"
              subtitle="Revenue lands automatically, refunds included"
              action={<Badge tone={stripeReady ? 'good' : 'neutral'}>{stripeReady ? 'Configured' : 'Not configured'}</Badge>}
            />
            <div className="space-y-3 p-4">
              {!stripeReady ? (
                <div className="space-y-2 text-xs leading-relaxed text-text-subtle">
                  <p>Set two environment variables in your Vercel project, then redeploy:</p>
                  <CodeBlock code={'STRIPE_SECRET_KEY=sk_live_…\nSTRIPE_WEBHOOK_SECRET=whsec_…'} multiline />
                  <p>
                    Keys live in env vars, never in the database — Pulse only stores which Stripe
                    objects map to which project.
                  </p>
                </div>
              ) : null}

              <div>
                <p className="mb-2 text-xs font-medium text-text">Webhook endpoint</p>
                <p className="mb-2 text-xs text-text-subtle">
                  Add this in the Stripe dashboard, subscribing to{' '}
                  <code className="font-mono">payment_intent.succeeded</code>,{' '}
                  <code className="font-mono">invoice.paid</code>,{' '}
                  <code className="font-mono">charge.refunded</code>, and{' '}
                  <code className="font-mono">charge.dispute.*</code>.
                </p>
                <CodeBlock code={`${origin}/api/webhooks/stripe`} />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Revenue routing" subtitle="Which Stripe money belongs to which project" />
            <StripeMappings projects={projects} mappings={mappings ?? []} />
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <CardHeader title="Goals" subtitle="Targets and milestones, optionally shown publicly" />
          <GoalsPanel projects={projects} goals={goals} currency={displayCurrency()} />
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Connected apps"
            subtitle="AI assistants that can create projects and read ingest keys"
            action={
              <Badge tone={mcpConfigured && mcpOn ? 'good' : 'neutral'}>
                {!mcpConfigured ? 'Not configured' : mcpOn ? 'On' : 'Off'}
              </Badge>
            }
          />
          <ConnectedApps apps={apps} enabled={mcpOn} configured={mcpConfigured} />
          {mcpConfigured && mcpOn ? (
            <div className="border-t border-border p-4">
              <p className="mb-2 text-xs font-medium text-text">MCP endpoint</p>
              <p className="mb-2 text-xs text-text-subtle">
                Add this URL as a custom connector. Your assistant will walk you through approving it.
              </p>
              <CodeBlock code={`${origin}/api/mcp`} />
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
