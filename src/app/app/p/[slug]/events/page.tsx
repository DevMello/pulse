import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getProjectBySlug, getBreakdown, getSeries, sumTotals, resolveRange } from '@/lib/queries';
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

  const [events, series] = await Promise.all([
    getBreakdown(db, ids, 'event', range, 25),
    getSeries(db, ids, range),
  ]);

  const totals = sumTotals(series);
  const selectedSteps = steps ? steps.split(',').filter(Boolean) : [];

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
                <code className="rounded bg-ink-850 px-1 py-0.5 font-mono text-xs">
                  pulse(&apos;signup&apos;)
                </code>{' '}
                anywhere in your site&apos;s JavaScript. Attach revenue with{' '}
                <code className="rounded bg-ink-850 px-1 py-0.5 font-mono text-xs">
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
          <CardHeader title="Funnel" subtitle="Pick events in order to see drop-off" />
          <Funnel
            available={events.map((e) => e.value)}
            selected={selectedSteps}
            counts={Object.fromEntries(events.map((e) => [e.value, e.hits]))}
            visitors={totals.visitors}
          />
        </Card>
      </div>
    </div>
  );
}
