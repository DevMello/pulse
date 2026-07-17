import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getProjectBySlug, getBreakdown, resolveRange } from '@/lib/queries';
import { Card, CardHeader, BarList } from '@/components/ui';
import { RangePicker } from '@/components/range-picker';

/** Traffic detail (Section 9.2). Every panel is one dimension of the rollups. */
export default async function TrafficPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { slug } = await params;
  const { range: rangeKey = '30d' } = await searchParams;

  const db = await supabaseServer();
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();

  const range = resolveRange(rangeKey);
  const ids = [project.id];

  const [pages, entries, exits, sources, countries, browsers, oses, devices, campaigns, mediums] =
    await Promise.all([
      getBreakdown(db, ids, 'path', range, 12),
      getBreakdown(db, ids, 'entry', range, 8),
      getBreakdown(db, ids, 'exit', range, 8),
      getBreakdown(db, ids, 'referrer', range, 12),
      getBreakdown(db, ids, 'country', range, 12),
      getBreakdown(db, ids, 'browser', range, 8),
      getBreakdown(db, ids, 'os', range, 8),
      getBreakdown(db, ids, 'device', range, 4),
      getBreakdown(db, ids, 'utm_campaign', range, 8),
      getBreakdown(db, ids, 'utm_medium', range, 8),
    ]);

  const domain = project.domains[0];

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <RangePicker current={rangeKey} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top pages" subtitle="Pageviews" />
          <BarList
            items={pages.map((p) => ({
              label: p.value,
              value: p.hits,
              // Link straight to the live page — the most common next action
              // after noticing a page doing well or badly.
              href: domain ? `https://${domain}${p.value.split('#')[0]}` : undefined,
            }))}
          />
        </Card>

        <Card>
          <CardHeader title="Sources" subtitle="Where visitors came from" />
          <BarList items={sources.map((s) => ({ label: s.value, value: s.hits }))} />
        </Card>

        <Card>
          <CardHeader title="Entry pages" subtitle="Where sessions started" />
          <BarList items={entries.map((p) => ({ label: p.value, value: p.hits }))} valueLabel="sessions" />
        </Card>

        <Card>
          <CardHeader title="Exit pages" subtitle="Where sessions ended" />
          <BarList items={exits.map((p) => ({ label: p.value, value: p.hits }))} valueLabel="sessions" />
        </Card>

        <Card>
          <CardHeader title="Countries" subtitle="Derived from IP at ingest, then the IP is discarded" />
          <BarList
            items={countries.map((c) => ({ label: countryName(c.value), value: c.hits }))}
          />
        </Card>

        <Card>
          <CardHeader title="Devices" />
          <BarList items={devices.map((d) => ({ label: titleCase(d.value), value: d.hits }))} />
          <div className="border-t border-ink-850">
            <BarList items={browsers.map((b) => ({ label: b.value, value: b.hits }))} />
          </div>
          <div className="border-t border-ink-850">
            <BarList items={oses.map((o) => ({ label: o.value, value: o.hits }))} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Campaigns" subtitle="utm_campaign" />
          <BarList items={campaigns.map((c) => ({ label: c.value, value: c.hits }))} emptyMessage="No campaign traffic. Tag links with ?utm_campaign=… to see them here." />
        </Card>

        <Card>
          <CardHeader title="Mediums" subtitle="utm_medium" />
          <BarList items={mediums.map((m) => ({ label: m.value, value: m.hits }))} emptyMessage="No tagged mediums yet." />
        </Card>
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
