import Link from 'next/link';
import { supabasePublic } from '@/lib/supabase/server';
import { Sparkline } from '@/components/ui';
import { LiveCount } from './live-count';
import { Methodology } from './methodology';
import { RangeLinks } from './range-links';
import { formatMoneyCompact, displayCurrency } from '@/lib/money';

/**
 * The public stats page body (Section 10), shared by /stats and /stats/[days].
 *
 * Rendered only by statically-generated routes with ISR, never from
 * searchParams. That distinction is the whole ballgame: a page that reads
 * searchParams is dynamic, and a dynamic page is one database query per
 * visitor. As a static route it's one query per 5 minutes no matter how many
 * people are watching — which is what makes a viral moment free rather than a
 * database incident.
 *
 * The live count is the one thing that must be fresh, so it's fetched
 * client-side and can't drag the rest of the page out of the cache.
 */

interface MaskedNumber {
  value: number | null;
  display: string | null;
}

interface PublicProject {
  slug: string;
  name: string;
  number_style: string;
  visitors?: MaskedNumber;
  pageviews?: MaskedNumber;
  revenue_cents?: number;
  trend: { visitors: number | null; pageviews: number | null; revenue?: number | null };
  series: Array<{ date: string; visitors?: number; pageviews?: number; revenue?: number }>;
}

interface Overview {
  range_days: number;
  generated_at: string;
  title: string | null;
  bio: string | null;
  totals: { visitors: number; pageviews: number; revenue_cents: number | null };
  projects: PublicProject[];
  milestones: Array<{ label: string; metric: string; target: number; achieved_at: string | null }>;
}

export async function StatsView({ days }: { days: number }) {
  // Runs as `anon`, which has no table grants at all. This RPC is the only way
  // this page can read anything, and it applies the owner's visibility toggles
  // before returning a single byte.
  const db = supabasePublic();
  const { data, error } = await db.rpc('pulse_public_overview', { p_days: days });

  if (error) return <Unavailable message={error.message} />;

  const overview = data as Overview;
  const hasProjects = overview.projects.length > 0;
  const currency = displayCurrency();
  const anyRevenue = overview.totals.revenue_cents !== null;

  // 'relative' withholds absolute figures entirely, so a headline number would
  // be a blank box. Detect it and lean on trends instead.
  const allRelative = hasProjects && overview.projects.every((p) => p.number_style === 'relative');

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-12 sm:py-16">
      <header className="mb-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-50 sm:text-3xl">
              {overview.title ?? 'Open Metrics'}
            </h1>
            {overview.bio ? (
              <p className="mt-2 max-w-xl text-sm leading-relaxed whitespace-pre-line text-ink-400">
                {overview.bio}
              </p>
            ) : null}
          </div>
          <LiveCount />
        </div>
      </header>

      {!hasProjects ? (
        <NothingPublished />
      ) : (
        <>
          <RangeLinks current={days} />

          <section className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-ink-850 bg-ink-850 sm:grid-cols-3">
            <Tile
              label="Visitors"
              value={allRelative ? '—' : formatCount(overview.totals.visitors)}
              sub={`last ${overview.range_days} days`}
            />
            <Tile
              label="Pageviews"
              value={allRelative ? '—' : formatCount(overview.totals.pageviews)}
              sub={`last ${overview.range_days} days`}
            />
            {anyRevenue ? (
              <Tile
                label="Revenue"
                value={formatMoneyCompact(overview.totals.revenue_cents ?? 0, currency)}
                sub="net of refunds"
                accent
              />
            ) : (
              <Tile label="Projects" value={String(overview.projects.length)} sub="published" />
            )}
          </section>

          {overview.milestones.length > 0 ? (
            <section className="mt-6 flex flex-wrap gap-2">
              {overview.milestones.map((m, i) => (
                <span
                  key={i}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    m.achieved_at
                      ? 'border-pulse-600/40 bg-pulse-600/10 text-pulse-400'
                      : 'border-ink-800 bg-ink-900 text-ink-500'
                  }`}
                >
                  {m.achieved_at ? '🎉 ' : '◦ '}
                  {m.label}
                  {m.achieved_at ? (
                    <span className="ml-1.5 text-ink-600">
                      {new Date(m.achieved_at).toLocaleDateString('en', { month: 'short', year: 'numeric' })}
                    </span>
                  ) : null}
                </span>
              ))}
            </section>
          ) : null}

          <section className="mt-6 space-y-4">
            {overview.projects.map((p) => (
              <ProjectCard key={p.slug} project={p} currency={currency} days={days} />
            ))}
          </section>
        </>
      )}

      <Methodology />

      <footer className="mt-10 border-t border-ink-850 pt-6 text-center">
        <p className="text-xs text-ink-700">
          Measured with{' '}
          <Link href="https://github.com/DevMello/pulse" className="text-ink-500 hover:text-ink-300">
            Pulse
          </Link>
          {' · '}
          {/* Fixed locale and timezone: this renders at build/revalidate time on
              the server, so a viewer-local format would be the *server's* idea
              of local and would mismatch the client on hydration. */}
          <time dateTime={overview.generated_at}>
            updated{' '}
            {new Date(overview.generated_at).toLocaleString('en-US', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'UTC',
            })}{' '}
            UTC
          </time>
        </p>
      </footer>
    </main>
  );
}

/**
 * Zero-fills the series across the whole range.
 *
 * The RPC only returns days that have a rollup row, so quiet days are absent
 * rather than zero. Plotting that directly would compress the x-axis and draw a
 * smooth line between two points a month apart — a chart that flatters the data
 * by hiding the gaps. Days with no traffic are real information and should read
 * as zero.
 */
function zeroFill(series: PublicProject['series'], days: number): number[] {
  const byDate = new Map(series.map((s) => [s.date, s.visitors ?? s.pageviews ?? 0]));

  const out: number[] = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() - (days - 1));

  for (let i = 0; i < days; i++) {
    out.push(byDate.get(cursor.toISOString().slice(0, 10)) ?? 0);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function ProjectCard({
  project,
  currency,
  days,
}: {
  project: PublicProject;
  currency: string;
  days: number;
}) {
  const relative = project.number_style === 'relative';
  const points = zeroFill(project.series, days);

  return (
    <article className="overflow-hidden rounded-xl border border-ink-850 bg-ink-900/50">
      <div className="flex flex-wrap items-start justify-between gap-4 px-4 pt-4">
        <h2 className="text-base font-medium text-ink-100">{project.name}</h2>
        <div className="flex flex-wrap items-baseline gap-5">
          {project.visitors ? (
            <Metric label="visitors" masked={project.visitors} trend={project.trend.visitors} relative={relative} />
          ) : null}
          {project.pageviews ? (
            <Metric label="views" masked={project.pageviews} trend={project.trend.pageviews} relative={relative} />
          ) : null}
          {project.revenue_cents !== undefined ? (
            <div className="text-right">
              <div className="nums text-lg font-semibold text-money-400">
                {formatMoneyCompact(project.revenue_cents, currency)}
              </div>
              <div className="text-xs text-ink-600">revenue</div>
            </div>
          ) : null}
        </div>
      </div>

      {points.some((p) => p > 0) ? (
        <div className="mt-3">
          <Sparkline points={points} height={56} label={`${project.name} trend`} />
        </div>
      ) : (
        <div className="h-4" />
      )}
    </article>
  );
}

/**
 * Renders a masked number.
 *
 * The database already decided what may be shown: `value` is null when the
 * style forbids exact figures. This component never receives a hidden number,
 * so it cannot leak one.
 */
function Metric({
  label,
  masked,
  trend,
  relative,
}: {
  label: string;
  masked: MaskedNumber;
  trend: number | null;
  relative: boolean;
}) {
  const text =
    masked.display ??
    (masked.value !== null ? formatCount(masked.value) : trend !== null ? formatTrend(trend) : '—');

  return (
    <div className="text-right">
      <div className="nums text-lg font-semibold text-ink-50">{text}</div>
      <div className="text-xs text-ink-600">
        {label}
        {!relative && trend !== null && Math.abs(trend) >= 0.05 ? (
          <span className={trend > 0 ? ' text-pulse-500' : ' text-danger-400'}>
            {' '}
            {trend > 0 ? '↑' : '↓'}
            {Math.abs(trend).toFixed(0)}%
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className="bg-ink-950 px-4 py-5">
      <div className="text-xs font-medium tracking-wide text-ink-600 uppercase">{label}</div>
      <div className={`nums mt-1 text-2xl font-semibold sm:text-3xl ${accent ? 'text-money-400' : 'text-ink-50'}`}>
        {value}
      </div>
      <div className="mt-0.5 text-xs text-ink-700">{sub}</div>
    </div>
  );
}

function NothingPublished() {
  return (
    <div className="rounded-xl border border-dashed border-ink-800 px-6 py-16 text-center">
      <p className="text-sm text-ink-400">Nothing is published yet.</p>
      <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-ink-600">
        Projects are private by default. The owner can publish one, and choose exactly which metrics
        appear, from the dashboard.
      </p>
    </div>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <div className="w-full rounded-xl border border-ink-850 p-6 text-center">
        <p className="text-sm text-ink-300">Stats are unavailable right now.</p>
        {/* Safe to surface: this path only ever reads published aggregates, so
            an error here cannot describe private data. */}
        <p className="mt-2 font-mono text-xs break-words text-ink-700">{message}</p>
      </div>
    </main>
  );
}

function formatCount(n: number): string {
  if (n < 10_000) return n.toLocaleString('en-US');
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

function formatTrend(t: number): string {
  return `${t > 0 ? '+' : ''}${t.toFixed(0)}%`;
}
