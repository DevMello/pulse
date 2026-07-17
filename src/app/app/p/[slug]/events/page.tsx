import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getProjectBySlug, getBreakdown, getSeries, getFunnel, sumTotals, resolveRange } from '@/lib/queries';
import { Card, CardHeader, BarList, Empty, compact } from '@/components/ui';
import { RangePicker } from '@/components/range-picker';
import { Funnel } from './funnel';

/**
 * Custom events and funnels (Section 9.2).
 */
export default async function EventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string; steps?: string }>;
}) {
  const { slug } = await params;
  const { range: rangeKey = '30d', steps } = await searchParams;

  const db = await supabaseServer();
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();

  const range = resolveRange(rangeKey);
  const ids = [project.id];

  // The SQL caps a funnel at 10 steps; clamping here keeps a hand-edited URL
  // from turning into a 500.
  const selectedSteps = (steps ? steps.split(',').filter(Boolean) : []).slice(0, 10);

  const [events, series, funnel] = await Promise.all([
    getBreakdown(db, ids, 'event', range, 25),
    getSeries(db, ids, range),
    getFunnel(db, ids, selectedSteps, range),
  ]);

  const totals = sumTotals(series);

  // The funnel walks raw events, which cron prunes past the retention window.
  // When the selected range reaches further back than that, the counts only
  // cover what still exists — say so instead of letting the number lie quietly.
  const retentionCutoff = new Date(Date.now() - project.retention_days * 86_400_000);
  const beyondRetention = range.from < retentionCutoff;

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <RangePicker current={rangeKey} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Events"
            subtitle={`${compact(totals.events)} fired in ${range.label.toLowerCase()}`}
          />
          {events.length === 0 ? (
            <Empty title="No custom events yet">
              <p>
                Call{' '}
                <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-xs">
                  pulse(&apos;signup&apos;)
                </code>{' '}
                anywhere in your site&apos;s JavaScript. Attach revenue with{' '}
                <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-xs">
                  {`pulse('purchase', { revenue: { amount: 29 } })`}
                </code>
                .
              </p>
            </Empty>
          ) : (
            <BarList
              items={events.map((e) => ({ label: e.value, value: e.hits }))}
              valueLabel="fires"
            />
          )}
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Funnel" subtitle="Pick events in order to see per-visitor drop-off" />
          <Funnel
            available={events.map((e) => e.value)}
            selected={selectedSteps}
            stepVisitors={Object.fromEntries(selectedSteps.map((s, i) => [s, funnel.steps[i] ?? 0]))}
            visitors={funnel.visitors}
            beyondRetention={beyondRetention}
            retentionDays={project.retention_days}
          />
        </Card>
      </div>
    </div>
  );
}
