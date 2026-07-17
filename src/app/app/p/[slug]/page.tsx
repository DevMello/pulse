import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import {
  getProjectBySlug, getSeries, getBreakdown, sumTotals, resolveRange,
  previousRange, pctChange, fillSeries, bounceRate, avgDuration,
} from '@/lib/queries';
import { Card, CardHeader, Stat, Sparkline, BarList, compact } from '@/components/ui';
import { RangePicker } from '@/components/range-picker';
import { Snippet } from '@/components/snippet';
import { formatMoneyCompact, displayCurrency } from '@/lib/money';
import { siteOrigin } from '@/lib/site';

export default async function ProjectOverview({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string; created?: string }>;
}) {
  const { slug } = await params;
  const { range: rangeKey = '30d', created } = await searchParams;

  const db = await supabaseServer();
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();

  const range = resolveRange(rangeKey);
  const prev = previousRange(range);
  const ids = [project.id];

  const [series, prevSeries, pages, sources] = await Promise.all([
    getSeries(db, ids, range),
    getSeries(db, ids, prev),
    getBreakdown(db, ids, 'path', range, 7),
    getBreakdown(db, ids, 'referrer', range, 7),
  ]);

  const totals = sumTotals(series);
  const prevTotals = sumTotals(prevSeries);
  const filled = fillSeries(series, range);
  const currency = displayCurrency();
  const br = bounceRate(totals);
  const dur = avgDuration(totals);

  // A project with no data at all is almost always one that was just created
  // and never had the snippet installed. Lead with the snippet, not with a wall
  // of zeroes.
  const neverReceivedData = totals.pageviews === 0 && totals.events === 0;

  return (
    <div className="space-y-5">
      {created ? (
        <div className="rounded-lg border border-pulse-600/30 bg-pulse-600/5 px-4 py-3 text-sm text-pulse-400">
          Project created. Paste the snippet below and your first pageview should land within seconds.
        </div>
      ) : null}

      {neverReceivedData ? (
        <Card>
          <CardHeader title="Install" subtitle="No events received yet" />
          <Snippet ingestKey={project.ingest_key} origin={await siteOrigin()} />
        </Card>
      ) : null}

      <div className="flex justify-end">
        <RangePicker current={rangeKey} />
      </div>

      <Card>
        <div className="grid grid-cols-2 divide-ink-850 sm:grid-cols-5 sm:divide-x">
          <Stat label="Visitors" value={compact(totals.visitors)} delta={pctChange(prevTotals.visitors, totals.visitors)} />
          <Stat label="Pageviews" value={compact(totals.pageviews)} delta={pctChange(prevTotals.pageviews, totals.pageviews)} />
          <Stat
            label="Bounce"
            value={br === null ? '—' : `${br.toFixed(0)}%`}
            hint="single-page visits"
          />
          <Stat
            label="Avg. visit"
            value={dur === null ? '—' : formatDuration(dur)}
            hint="engaged sessions"
          />
          <Stat
            label="Revenue"
            value={formatMoneyCompact(totals.revenue_cents, currency)}
            delta={pctChange(prevTotals.revenue_cents, totals.revenue_cents)}
            accent="money"
          />
        </div>
        <div className="border-t border-ink-850 px-1 pt-2 pb-1">
          <Sparkline points={filled.map((p) => p.visitors)} height={110} label={`Visitors, ${range.label}`} />
        </div>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader title="Top pages" />
          <BarList
            items={pages.map((p) => ({ label: p.value, value: p.hits }))}
            emptyMessage="No pageviews in this range."
          />
        </Card>

        <Card>
          <CardHeader title="Top sources" />
          <BarList
            items={sources.map((s) => ({ label: s.value, value: s.hits }))}
            emptyMessage="No referrers in this range."
          />
        </Card>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
