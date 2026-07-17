import { notFound } from 'next/navigation';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import {
  getProjectBySlug, getSeries, getBreakdown, getFunnel, sumTotals, resolveRange,
  previousRange, pctChange, fillSeries,
} from '@/lib/queries';
import { METRICS, resolveMetric, formatMetric } from '@/lib/metrics';
import { toChannels, CHANNEL_FOLD_LIMIT } from '@/lib/channels';
import { Card, CardHeader, MetricTile, BarList, Empty, compact } from '@/components/ui';
import { Chart } from '@/components/chart';
import { TabbedPanel } from '@/components/tabbed-panel';
import { WorldMap } from '@/components/world-map';
import { RangePicker } from '@/components/range-picker';
import { Snippet } from '@/components/snippet';
import { displayCurrency } from '@/lib/money';
import { siteOrigin } from '@/lib/site';
import { Funnel } from './events/funnel';

/**
 * The project dashboard.
 *
 * Everything lives on one page: headline tiles, one chart, and the breakdown
 * panels. The tile row doubles as the chart's metric picker.
 *
 * That's ~13 rollup reads in one Promise.all. They're all indexed reads against
 * pre-aggregated tables and they run concurrently, which is the entire reason
 * the rollups exist — the alternative is what this page replaced: the same data
 * split across two pages so neither felt slow.
 */
export default async function ProjectOverview({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string; metric?: string; created?: string; steps?: string }>;
}) {
  const { slug } = await params;
  const { range: rangeKey = '30d', metric: metricKey, created, steps } = await searchParams;

  const db = await supabaseServer();
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();

  const range = resolveRange(rangeKey);
  const prev = previousRange(range);
  const ids = [project.id];
  const metric = resolveMetric(metricKey);
  // Same clamp as the events page: the SQL caps a funnel at 10 steps.
  const selectedSteps = (steps ? steps.split(',').filter(Boolean) : []).slice(0, 10);

  const [
    series, prevSeries,
    pages, entries, exits,
    sources, campaigns, mediums,
    countries,
    browsers, oses, devices,
    events,
    funnel,
  ] = await Promise.all([
    getSeries(db, ids, range),
    getSeries(db, ids, prev),
    getBreakdown(db, ids, 'path', range, 8),
    getBreakdown(db, ids, 'entry', range, 8),
    getBreakdown(db, ids, 'exit', range, 8),
    // Read deep, show shallow: the top 8 are all the Sources tab renders, but
    // Channels folds this same list and would understate Referral if it only
    // ever saw the head of it.
    getBreakdown(db, ids, 'referrer', range, CHANNEL_FOLD_LIMIT),
    getBreakdown(db, ids, 'utm_campaign', range, 8),
    getBreakdown(db, ids, 'utm_medium', range, 8),
    getBreakdown(db, ids, 'country', range, 250),
    getBreakdown(db, ids, 'browser', range, 8),
    getBreakdown(db, ids, 'os', range, 8),
    getBreakdown(db, ids, 'device', range, 4),
    getBreakdown(db, ids, 'event', range, 8),
    getFunnel(db, ids, selectedSteps, range),
  ]);

  const totals = sumTotals(series);
  const prevTotals = sumTotals(prevSeries);
  const filled = fillSeries(series, range);
  const currency = displayCurrency();
  const domain = project.domains[0];

  // A project with no data at all is almost always one that was just created and
  // never had the snippet installed. Lead with the snippet, not with a wall of
  // zeroes.
  const neverReceivedData = totals.pageviews === 0 && totals.events === 0;

  const href = (key: string) => {
    const q = new URLSearchParams();
    if (rangeKey !== '30d') q.set('range', rangeKey);
    if (key !== 'visitors') q.set('metric', key);
    const s = q.toString();
    return s ? `?${s}` : '';
  };

  return (
    <div className="space-y-5">
      {created ? (
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700">
          Project created. Paste the snippet below and your first pageview should land within seconds.
        </div>
      ) : null}

      {neverReceivedData ? (
        <Card>
          <CardHeader title="Install" subtitle="No events received yet" />
          <Snippet ingestKey={project.ingest_key} origin={await siteOrigin()} />
        </Card>
      ) : null}

      {/* The gradient is a backdrop, and the widgets are light cards floating on
          it — which is how the reference dashboard is actually built, and the
          only arrangement where 12px text on this surface can be read. The only
          thing drawn directly on the gradient is solid-white chrome. */}
      <section className="brand-panel overflow-hidden rounded-2xl p-3 shadow-lg shadow-brand-500/20 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-sm font-semibold text-white">{range.label}</h2>
          <RangePicker current={rangeKey} tone="onBrand" />
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1 shadow-sm sm:grid-cols-4 lg:grid-cols-7">
          {METRICS.map((m) => {
            const value = m.total(totals);
            const prevValue = m.total(prevTotals);
            return (
              <MetricTile
                key={m.key}
                label={m.label}
                hint={m.hint}
                accent={m.accent}
                // Bounce rate is the one metric where up is bad.
                invert={m.invert}
                href={href(m.key)}
                selected={m.key === metric.key}
                value={value === null ? '—' : formatMetric(m.format, value, currency)}
                delta={
                  value === null || prevValue === null ? undefined : pctChange(prevValue, value)
                }
              />
            );
          })}
        </div>

        <div className="mt-2 rounded-xl bg-surface p-4 shadow-sm">
          <Chart
            points={filled.map((p) => ({ bucket: p.bucket, value: metric.point(p) }))}
            period={range.period}
            format={metric.format}
            currency={currency}
            color={metric.color}
            label={`${metric.label}, ${range.label}`}
          />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <TabbedPanel
          title="Sources"
          tabs={[
            {
              key: 'channels',
              label: 'Channels',
              content: (
                <BarList
                  items={toChannels(sources).map((c) => ({ label: c.value, value: c.hits }))}
                  emptyMessage="No traffic in this range."
                />
              ),
            },
            {
              key: 'sources',
              label: 'Sources',
              content: (
                <BarList
                  items={sources.slice(0, 8).map((s) => ({ label: s.value, value: s.hits }))}
                  emptyMessage="No referrers in this range."
                />
              ),
            },
            {
              key: 'campaigns',
              label: 'Campaigns',
              content: (
                <BarList
                  items={campaigns.map((c) => ({ label: c.value, value: c.hits }))}
                  emptyMessage="No campaign traffic. Tag links with ?utm_campaign=… to see them here."
                />
              ),
            },
            {
              key: 'mediums',
              label: 'Mediums',
              content: (
                <BarList
                  items={mediums.map((m) => ({ label: m.value, value: m.hits }))}
                  emptyMessage="No tagged mediums yet."
                />
              ),
            },
          ]}
        />

        <TabbedPanel
          title="Pages"
          tabs={[
            {
              key: 'top',
              label: 'Top Pages',
              content: (
                <BarList
                  items={pages.map((p) => ({
                    label: p.value,
                    value: p.hits,
                    // Straight to the live page — the most common next action
                    // after noticing a page doing well or badly.
                    href: domain ? `https://${domain}${p.value.split('#')[0]}` : undefined,
                  }))}
                  emptyMessage="No pageviews in this range."
                />
              ),
            },
            {
              key: 'entry',
              label: 'Entry Pages',
              content: (
                <BarList
                  items={entries.map((p) => ({ label: p.value, value: p.hits }))}
                  valueLabel="sessions"
                  emptyMessage="No sessions in this range."
                />
              ),
            },
            {
              key: 'exit',
              label: 'Exit Pages',
              content: (
                <BarList
                  items={exits.map((p) => ({ label: p.value, value: p.hits }))}
                  valueLabel="sessions"
                  emptyMessage="No sessions in this range."
                />
              ),
            },
          ]}
        />

        <TabbedPanel
          title="Locations"
          className="lg:col-span-2"
          tabs={[
            {
              key: 'map',
              label: 'Map',
              content: <WorldMap rows={countries} />,
            },
            {
              key: 'countries',
              label: 'Countries',
              content: (
                <BarList
                  items={countries.slice(0, 12).map((c) => ({ label: countryName(c.value), value: c.hits }))}
                  emptyMessage="No location data in this range."
                />
              ),
            },
          ]}
        />

        <TabbedPanel
          title="Devices"
          tabs={[
            {
              key: 'browsers',
              label: 'Browsers',
              content: <BarList items={browsers.map((b) => ({ label: b.value, value: b.hits }))} />,
            },
            {
              key: 'os',
              label: 'Operating Systems',
              content: <BarList items={oses.map((o) => ({ label: o.value, value: o.hits }))} />,
            },
            {
              key: 'devices',
              label: 'Devices',
              content: (
                <BarList items={devices.map((d) => ({ label: titleCase(d.value), value: d.hits }))} />
              ),
            },
          ]}
        />

        {/* Plausible calls this Behaviours and fills it with Goals / Properties /
            Funnels. Pulse ships the two of those it can answer honestly: its
            `goals` table holds public milestone targets, not per-event
            conversions, and custom event props are stored but never rolled up,
            so a Properties tab would be a permanently empty promise. */}
        <TabbedPanel
          title="Behaviours"
          action={
            <Link href={`/app/p/${slug}/events`} className="text-xs font-medium text-brand-600 hover:underline">
              All events →
            </Link>
          }
          tabs={[
            {
              key: 'events',
              label: 'Events',
              content:
                events.length === 0 ? (
                  <Empty title="No custom events yet">
                    <p>
                      Call{' '}
                      <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-xs">
                        pulse(&apos;signup&apos;)
                      </code>{' '}
                      anywhere in your site&apos;s JavaScript.
                    </p>
                  </Empty>
                ) : (
                  <BarList
                    items={events.map((e) => ({ label: e.value, value: e.hits }))}
                    valueLabel="fires"
                  />
                ),
            },
            {
              key: 'funnels',
              label: 'Funnels',
              content: (
                <Funnel
                  available={events.map((e) => e.value)}
                  selected={selectedSteps}
                  stepVisitors={Object.fromEntries(selectedSteps.map((s, i) => [s, funnel.steps[i] ?? 0]))}
                  visitors={funnel.visitors}
                  beyondRetention={range.from < new Date(Date.now() - project.retention_days * 86_400_000)}
                  retentionDays={project.retention_days}
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * ISO country code -> name, via the platform's own data. Intl.DisplayNames
 * ships with Node and every modern browser, so a 250-entry lookup table would
 * be dead weight that also goes stale.
 */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
