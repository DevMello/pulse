import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, PulseMark, Sparkline, Stat, BarList } from '@/components/ui';
import { CodeBlock } from '@/components/snippet';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * The landing page.
 *
 * Built entirely from the product's own primitives — Card, Stat, Sparkline,
 * BarList, the brand panel — so the pitch and the product are provably the same
 * thing. The "screenshot" in the hero is the real dashboard components fed
 * static numbers, which can't drift stale the way an image export would.
 *
 * Still a server component with no data access: everything here is copy.
 */

export const metadata: Metadata = {
  title: 'Pulse — privacy-first analytics you run yourself',
  description:
    'Self-hosted, privacy-first analytics with revenue tracking and a public stats page. A ~1 KB script, no cookies, no consent banner. Runs free on your own Vercel and Supabase.',
  // The root layout defaults to noindex for the dashboard; the landing page is
  // the one page that exists to be found.
  robots: { index: true, follow: true },
};

const GITHUB = 'https://github.com/DevMello/pulse';

/* Demo numbers for the hero preview: a plausible indie project's month —
   weekday/weekend shape with a gentle upward trend, not hockey-stick fiction. */
const DEMO_SERIES = [
  310, 342, 355, 348, 361, 244, 218, 352, 388, 396, 384, 402, 261, 240, 398, 421,
  409, 434, 452, 287, 265, 441, 468, 483, 471, 495, 312, 290, 508, 531,
];

const DEMO_SOURCES = [
  { label: 'github.com', value: 4820 },
  { label: 'Google', value: 3140 },
  { label: 'news.ycombinator.com', value: 2260 },
  { label: 'Direct / none', value: 1930 },
];

export default function Home() {
  const showLanding = process.env.NEXT_PUBLIC_PULSE_SHOW_LANDING !== 'false';
  const showLive = process.env.NEXT_PUBLIC_PULSE_SHOW_LIVE !== 'false';
  if (!showLanding || !showLive) redirect('/app');

  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  if (!configured) return <SetupNeeded />;

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-display text-sm font-bold text-text">
          <PulseMark boxed />
          Pulse
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Site">
          <Link
            href="/stats"
            className="rounded-lg px-2.5 py-1.5 text-sm text-text-subtle transition hover:bg-surface-sunken hover:text-text"
          >
            Live demo
          </Link>
          <a
            href={GITHUB}
            className="rounded-lg px-2.5 py-1.5 text-sm text-text-subtle transition hover:bg-surface-sunken hover:text-text"
          >
            GitHub
          </a>
          <ThemeToggle />
          <Link
            href="/app"
            className="ml-1 rounded-lg bg-brand-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm shadow-brand-500/25 transition hover:bg-brand-600"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-20 px-4 pt-6 pb-20 sm:space-y-24">
        {/* ------------------------------------------------------------ hero */}
        <section className="brand-panel rounded-3xl px-6 py-10 sm:px-10 sm:py-14">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            {/* Per .brand-panel's contract: only pure-white headline-scale text
                sits directly on the gradient; everything smaller lives in the
                light card beside it. */}
            <div>
              <h1 className="font-display text-3xl leading-tight font-bold text-white sm:text-4xl">
                Traffic and revenue, on one page you can show anyone.
              </h1>
              <p className="mt-4 max-w-lg text-base leading-relaxed text-white">
                Pulse is privacy-first analytics you run yourself, on the Vercel and Supabase you
                already have. A ~1&nbsp;KB script, no cookies, no consent banner — and a public
                stats page for building in public.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link
                  href="/app"
                  className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-ink-100"
                >
                  Open your dashboard
                </Link>
                <Link
                  href="/stats"
                  className="rounded-lg border border-white/40 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  See a live stats page
                </Link>
              </div>
            </div>

            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <span className="font-display text-sm font-semibold text-text">acme.dev</span>
                <span className="flex items-center gap-1.5 text-xs text-text-subtle">
                  <span className="h-1.5 w-1.5 rounded-full bg-positive-500" aria-hidden="true" />
                  23 live · last 30 days
                </span>
              </div>
              <div className="grid grid-cols-3 divide-x divide-border">
                <Stat label="Visitors" value="12,481" delta={18.2} />
                <Stat label="Pageviews" value="28.9k" delta={12.4} />
                <Stat label="Revenue" value="$3,214" delta={6.4} accent="money" />
              </div>
              <Sparkline points={DEMO_SERIES} height={64} label="Example month of visitors" />
              <div className="border-t border-border">
                <BarList items={DEMO_SOURCES} valueLabel="visitors" />
              </div>
            </Card>
          </div>
        </section>

        {/* --------------------------------------------------------- snippet */}
        <section className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-2xl font-bold text-text">The whole integration</h2>
          <p className="mt-3 text-sm leading-relaxed text-text-muted">
            One deferred script tag — 928 bytes gzipped, measured and enforced in CI. Nothing
            touches your visitors except your own domain: no third-party pixel, no CDN, no
            fingerprinting library wearing a trench coat.
          </p>
          <div className="mt-5 text-left">
            <CodeBlock code={`<script defer data-key="YOUR_KEY" src="https://pulse.devmello.xyz/px.js"></script>`} />
          </div>
        </section>

        {/* -------------------------------------------------------- features */}
        <section aria-labelledby="features">
          <h2 id="features" className="sr-only">
            What Pulse does
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Feature title="No cookies. Actually none.">
              Visitors are counted with a salted hash whose salt is destroyed after 48 hours —
              cross-day tracking is impossible for anyone, including you. No banner needed, by
              design rather than by disclaimer.
            </Feature>
            <Feature title="Revenue is first-class">
              Stripe webhooks, SDK events, and manual entries land in one pipeline. Refunds and
              lost disputes are stored as negatives and subtract from the totals, so the headline
              number stays honest.
            </Feature>
            <Feature title="A public stats page, built in">
              Publish exactly the metrics you choose — exact, rounded, bucketed, or trends-only.
              Masking happens in the database: a hidden number is never serialized, so it can’t be
              fished out of the network tab.
            </Feature>
            <Feature title="Your database, your data">
              Everything lives in your Supabase Postgres. Query it with SQL, export it, or delete
              it — there is no vendor between you and your numbers, and no per-event bill.
            </Feature>
            <Feature title="The whole dashboard">
              Realtime, funnels, custom events, sources, countries, and a portfolio roll-up across
              every project — all reading pre-computed rollups, so charts stay fast as data grows.
            </Feature>
            <Feature title="$0 at indie scale">
              The public page is static and CDN-cached; a viral moment hits the CDN, not your
              database. The free tiers of Vercel and Supabase are enough.
            </Feature>
          </div>
        </section>

        {/* ----------------------------------------------------- how it works */}
        <section aria-labelledby="how" className="mx-auto max-w-4xl">
          <h2 id="how" className="text-center font-display text-2xl font-bold text-text">
            Up and running in an afternoon
          </h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-3">
            <Step n={1} title="Deploy">
              Fork the repo, import it into Vercel, set two environment variables, run the
              migrations. Both free tiers are enough.
            </Step>
            <Step n={2} title="Paste the snippet">
              Your first pageview lands within seconds — realtime, sources, and countries from day
              one.
            </Step>
            <Step n={3} title="Publish (if you want)">
              Flip on your public <code className="font-mono text-xs">/stats</code> page, embed the
              README badge, and build in public. Projects stay private by default.
            </Step>
          </ol>
        </section>

        {/* ---------------------------------------------------------- privacy */}
        <section aria-labelledby="privacy" className="grid items-start gap-8 lg:grid-cols-2">
          <div>
            <h2 id="privacy" className="font-display text-2xl font-bold text-text">
              Privacy as a property, not a promise
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-text-muted">
              Unique visitors are counted with a salted, daily-rotating hash. The IP is used to
              compute it and look up a country, then discarded. The salt is random per UTC day and
              destroyed after 48 hours — once it’s gone, that day’s hashes cannot be recomputed or
              reversed by anyone with any level of access.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-text-muted">
              The honest cost, which the public page states openly: two people behind one NAT on
              identical devices count once, one person on a phone and a laptop counts twice, and
              counting resets at UTC midnight. Pulse takes that trade over tracking you.
            </p>
          </div>
          <div>
            <CodeBlock code={`sha256( daily_salt + project_id + ip + user_agent )`} />
            <p className="mt-3 text-xs leading-relaxed text-text-subtle">
              Every input except the salt is already in an ordinary HTTP request, and none of them
              is stored. <code className="font-mono">project_id</code> is in the hash so one
              visitor can’t be correlated across two sites on the same Pulse instance.
            </p>
          </div>
        </section>

        {/* -------------------------------------------------------- final CTA */}
        <section className="rounded-3xl border border-border bg-surface px-6 py-12 text-center">
          <h2 className="font-display text-2xl font-bold text-text">
            Your analytics. Your database. Your call.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-text-muted">
            MIT licensed. Fork it, run it, sell things with it. If Pulse ever stops serving you,
            your data is already in your own Postgres.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a
              href={GITHUB}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand-500/25 transition hover:bg-brand-600"
            >
              Deploy from GitHub
            </a>
            <Link
              href="/stats"
              className="rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-surface-sunken hover:text-text"
            >
              See a live demo
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-4 py-6">
        <p className="mx-auto max-w-6xl text-xs text-text-subtle">
          Pulse · MIT licensed ·{' '}
          <a href={GITHUB} className="hover:text-text">
            GitHub
          </a>{' '}
          · No cookies were set in the making of this page.
        </p>
      </footer>
    </div>
  );
}

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card as="article" className="p-5">
      <h3 className="font-display text-sm font-semibold text-text">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">{children}</p>
    </Card>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-border bg-surface p-5">
      <span className="nums flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 font-display text-sm font-bold text-brand-700">
        {n}
      </span>
      <h3 className="mt-3 font-display text-sm font-semibold text-text">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{children}</p>
    </li>
  );
}

function SetupNeeded() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-4">
      <div className="w-full">
        <h1 className="font-display text-2xl font-bold text-text">Pulse isn&apos;t configured yet</h1>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          Set two environment variables and redeploy. That&apos;s the whole setup.
        </p>

        <pre className="mt-5 overflow-x-auto rounded-lg bg-ink-950 p-4 font-mono text-xs leading-relaxed text-ink-200">
          <code>{`NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci…`}</code>
        </pre>

        <p className="mt-4 text-xs leading-relaxed text-text-subtle">
          You&apos;ll also want <code className="font-mono text-text-subtle">SUPABASE_SERVICE_ROLE_KEY</code>{' '}
          so the collector can write events. Without it Pulse runs read-only.
        </p>

        <p className="mt-6 text-xs text-text-subtle">
          Full instructions are in the{' '}
          <Link href={`${GITHUB}#readme`} className="font-medium text-brand-600 hover:text-brand-700">
            README
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
