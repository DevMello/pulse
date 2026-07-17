import Link from 'next/link';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase/server';
import {
  getProjects, getSeries, sumTotals, resolveRange, previousRange,
  pctChange, fillSeries, getMrrProxy, getGoals, bounceRate,
} from '@/lib/queries';
import { Card, CardHeader, Stat, Sparkline, Delta, compact, Empty, Badge } from '@/components/ui';
import { RangePicker } from '@/components/range-picker';
import { formatMoneyCompact, displayCurrency } from '@/lib/money';

export const metadata: Metadata = { title: 'Portfolio' };

/**
 * The portfolio roll-up (Section 9.3): how is everything doing, at a glance.
 */
export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rangeKey = '30d' } = await searchParams;
  const db = await supabaseServer();

  const projects = await getProjects(db);
  if (projects.length === 0) return <FirstRun />;

  const range = resolveRange(rangeKey);
  const prev = previousRange(range);
  const ids = projects.map((p) => p.id);
  const currency = displayCurrency();

  const [series, prevSeries, mrr, goals] = await Promise.all([
    getSeries(db, ids, range),
    getSeries(db, ids, prev),
    getMrrProxy(db, ids),
    getGoals(db),
  ]);

  const totals = sumTotals(series);
  const prevTotals = sumTotals(prevSeries);
  const filled = fillSeries(series, range);

  // Per-project leaderboard for the same window.
  const perProject = await Promise.all(
    projects.map(async (p) => {
      const [s, ps] = await Promise.all([getSeries(db, [p.id], range), getSeries(db, [p.id], prev)]);
      return { project: p, totals: sumTotals(s), prev: sumTotals(ps), series: fillSeries(s, range) };
    })
  );

  const leaderboard = [...perProject].sort((a, b) => b.totals.visitors - a.totals.visitors);
  const publicGoals = goals.filter((g) => !g.achieved_at);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-50">Portfolio</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {projects.length} project{projects.length === 1 ? '' : 's'} · {range.label}
          </p>
        </div>
        <RangePicker current={rangeKey} />
      </div>

      {/* Headline */}
      <Card>
        <div className="grid grid-cols-2 divide-ink-850 sm:grid-cols-4 sm:divide-x">
          <Stat
            label="Visitors"
            value={compact(totals.visitors)}
            delta={pctChange(prevTotals.visitors, totals.visitors)}
            hint={range.period === 'day' && filled.length > 1 ? 'daily uniques, summed' : undefined}
          />
          <Stat
            label="Pageviews"
            value={compact(totals.pageviews)}
            delta={pctChange(prevTotals.pageviews, totals.pageviews)}
          />
          <Stat
            label="Revenue"
            value={formatMoneyCompact(totals.revenue_cents, currency)}
            delta={pctChange(prevTotals.revenue_cents, totals.revenue_cents)}
            accent="money"
          />
          <Stat
            label="MRR"
            value={formatMoneyCompact(mrr, currency)}
            hint="trailing 30d subscriptions"
            accent="money"
          />
        </div>
        <div className="border-t border-ink-850 px-1 pt-2 pb-1">
          <Sparkline
            points={filled.map((p) => p.visitors)}
            height={72}
            label={`Visitors over ${range.label}`}
          />
        </div>
      </Card>

      {/* Goals in progress */}
      {publicGoals.length > 0 ? (
        <Card>
          <CardHeader title="Goals" subtitle="Progress toward your targets" />
          <div className="divide-y divide-ink-850/60">
            {publicGoals.map((g) => {
              const current =
                g.metric === 'revenue' ? totals.revenue_cents
                : g.metric === 'mrr' ? mrr
                : g.metric === 'visitors' ? totals.visitors
                : totals.pageviews;
              const pct = g.target > 0 ? Math.min((current / g.target) * 100, 100) : 0;
              const money = g.metric === 'revenue' || g.metric === 'mrr';

              return (
                <div key={g.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink-300">{g.label ?? g.metric}</span>
                    <span className="nums text-ink-500">
                      {money ? formatMoneyCompact(current, currency) : compact(current)}
                      {' / '}
                      {money ? formatMoneyCompact(g.target, currency) : compact(g.target)}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-850">
                    <div className="h-full rounded-full bg-pulse-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {/* Leaderboard */}
      <Card>
        <CardHeader
          title="Projects"
          subtitle="Ranked by visitors this period"
          action={
            <Link href="/app/new" className="text-xs text-pulse-400 hover:text-pulse-300">
              New project
            </Link>
          }
        />
        <div className="divide-y divide-ink-850/60">
          {leaderboard.map(({ project, totals: t, prev: pt, series: s }) => {
            const br = bounceRate(t);
            return (
              <Link
                key={project.id}
                href={`/app/p/${project.slug}`}
                className="grid grid-cols-12 items-center gap-3 px-4 py-3 transition hover:bg-ink-900"
              >
                <div className="col-span-12 min-w-0 sm:col-span-3">
                  <div className="truncate text-sm font-medium text-ink-100">{project.name}</div>
                  <div className="truncate text-xs text-ink-600">
                    {project.domains[0] ?? <span className="text-money-500">no domain set</span>}
                  </div>
                </div>

                <div className="col-span-4 sm:col-span-2">
                  <div className="nums text-sm text-ink-200">{compact(t.visitors)}</div>
                  <div className="text-xs text-ink-600">visitors</div>
                </div>

                <div className="col-span-4 sm:col-span-2">
                  <div className="nums text-sm text-ink-200">{compact(t.pageviews)}</div>
                  <div className="text-xs text-ink-600">views</div>
                </div>

                <div className="col-span-4 sm:col-span-2">
                  <div className="nums text-sm text-money-400">
                    {formatMoneyCompact(t.revenue_cents, currency)}
                  </div>
                  <div className="text-xs text-ink-600">
                    {br === null ? 'revenue' : `${br.toFixed(0)}% bounce`}
                  </div>
                </div>

                <div className="col-span-8 sm:col-span-2">
                  <Sparkline points={s.map((p) => p.visitors)} height={28} label={`${project.name} trend`} />
                </div>

                <div className="col-span-4 text-right sm:col-span-1">
                  <Delta value={pctChange(pt.visitors, t.visitors)} />
                </div>
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function FirstRun() {
  return (
    <div className="mx-auto max-w-lg py-16">
      <Card>
        <Empty title="No projects yet">
          <p>
            A project is one site or app. Create one and you&apos;ll get a script tag to paste before
            <code className="mx-1 rounded bg-ink-850 px-1 py-0.5 font-mono text-xs">&lt;/body&gt;</code>.
            That&apos;s the whole integration.
          </p>
          <Link
            href="/app/new"
            className="mt-5 inline-block rounded-lg bg-pulse-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-pulse-400"
          >
            Create your first project
          </Link>
        </Empty>
      </Card>
    </div>
  );
}
