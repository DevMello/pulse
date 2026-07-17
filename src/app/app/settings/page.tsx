import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase/server';
import { getProjects, getGoals } from '@/lib/queries';
import { Card, CardHeader, Badge } from '@/components/ui';
import { CodeBlock } from '@/components/snippet';
import { siteOrigin } from '@/lib/site';
import { OwnerProfileForm } from './owner-profile-form';
import { StripeMappings } from './stripe-mappings';
import { GoalsPanel } from './goals-panel';
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

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-ink-50">Settings</h1>

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
                <div className="space-y-2 text-xs leading-relaxed text-ink-500">
                  <p>Set two environment variables in your Vercel project, then redeploy:</p>
                  <CodeBlock code={'STRIPE_SECRET_KEY=sk_live_…\nSTRIPE_WEBHOOK_SECRET=whsec_…'} multiline />
                  <p>
                    Keys live in env vars, never in the database — Pulse only stores which Stripe
                    objects map to which project.
                  </p>
                </div>
              ) : null}

              <div>
                <p className="mb-2 text-xs font-medium text-ink-300">Webhook endpoint</p>
                <p className="mb-2 text-xs text-ink-600">
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
      </div>
    </div>
  );
}
