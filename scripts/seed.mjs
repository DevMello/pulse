#!/usr/bin/env node
/**
 * Seed a Pulse instance with realistic demo data.
 *
 *   node scripts/seed.mjs --email you@example.com
 *
 * Creates the owner (through the Auth admin API, which is the only supported
 * way — writing auth.users directly produces a row GoTrue cannot read), two
 * projects, ~60 days of traffic with weekday/weekend shape, and a mix of
 * revenue. Then it rolls everything up.
 *
 * Useful for evaluating Pulse before pointing it at a real site, and for
 * working on the dashboard without waiting for real traffic.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';

// -- env ---------------------------------------------------------------------

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example).');
  process.exit(1);
}

const emailArg = process.argv.indexOf('--email');
const email = emailArg > -1 ? process.argv[emailArg + 1] : 'demo@example.com';
const days = 60;

const db = createClient(url, key, { auth: { persistSession: false } });

// -- deterministic randomness ------------------------------------------------
// Seeded so re-running produces the same shape; a chart that reshuffles on every
// seed makes it impossible to tell a code change from noise.

let seed = 42;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi) => Math.floor(rand() * (hi - lo + 1)) + lo;

// -- fixtures ----------------------------------------------------------------

const PROJECTS = [
  {
    name: 'Demo Blog',
    slug: 'demo-blog',
    domains: ['demo-blog.example'],
    baseTraffic: 90,
    paths: ['/', '/posts/shipping-fast', '/posts/why-sqlite', '/about', '/posts/analytics-from-scratch'],
    public: { is_public: true, show_revenue: false },
  },
  {
    name: 'Demo SaaS',
    slug: 'demo-saas',
    domains: ['demo-saas.example'],
    baseTraffic: 40,
    paths: ['/', '/pricing', '/docs', '/changelog', '/login'],
    public: { is_public: true, show_revenue: true },
  },
];

const REFERRERS = [
  ['Google', 'google.com'], ['Direct', null], ['Hacker News', 'news.ycombinator.com'],
  ['Twitter', 't.co'], ['Reddit', 'reddit.com'], ['GitHub', 'github.com'],
  ['Direct', null], ['Direct', null], ['Google', 'google.com'],
];
const COUNTRIES = ['US', 'US', 'US', 'GB', 'DE', 'FR', 'IN', 'CA', 'AU', 'BR', 'JP', 'NL'];
const BROWSERS = [['Chrome', 'macOS', 'desktop'], ['Chrome', 'Windows', 'desktop'], ['Safari', 'iOS', 'mobile'],
                  ['Firefox', 'Linux', 'desktop'], ['Safari', 'macOS', 'desktop'], ['Chrome', 'Android', 'mobile'],
                  ['Edge', 'Windows', 'desktop']];
const BUCKETS = ['xs', 'sm', 'md', 'lg', 'xl'];

// -- run ---------------------------------------------------------------------

console.log(`Seeding ${days} days of demo data for ${email}\n`);

// 1. Owner. Created via the Auth admin API so GoTrue owns the row.
const { data: existing } = await db.auth.admin.listUsers();
let user = existing?.users?.find((u) => u.email === email);

if (!user) {
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error) {
    console.error('Could not create the auth user:', error.message);
    process.exit(1);
  }
  user = data.user;
  console.log(`  created auth user ${email}`);
} else {
  console.log(`  reusing auth user ${email}`);
}

// The owner-claim trigger runs on this insert and refuses a second owner.
const { error: ownerError } = await db.from('owners').upsert(
  {
    id: user.id,
    email,
    public_title: 'Open Metrics',
    public_bio: 'Everything I’m building, in the open. Traffic and revenue, updated continuously.',
  },
  { onConflict: 'id' }
);
if (ownerError) {
  console.error('Could not claim ownership:', ownerError.message);
  process.exit(1);
}
console.log('  owner ready');

// 2. Projects
const created = [];
for (const spec of PROJECTS) {
  const { data: existingProject } = await db.from('projects').select('id').eq('slug', spec.slug).maybeSingle();

  let id = existingProject?.id;
  if (!id) {
    const { data, error } = await db
      .from('projects')
      .insert({ owner_id: user.id, name: spec.name, slug: spec.slug, domains: spec.domains, timezone: 'UTC' })
      .select('id')
      .single();
    if (error) {
      console.error(`  ${spec.name}: ${error.message}`);
      process.exit(1);
    }
    id = data.id;
  }

  await db.from('project_public_settings').update(spec.public).eq('project_id', id);
  created.push({ ...spec, id });
  console.log(`  project ${spec.name} (/${spec.slug})`);
}

// 3. Events
console.log('\nGenerating events…');
const now = Date.now();
const DAY = 86_400_000;

for (const project of created) {
  await db.from('events').delete().eq('project_id', project.id);

  const rows = [];
  for (let d = days - 1; d >= 0; d--) {
    const dayStart = now - d * DAY;
    const date = new Date(dayStart);
    const weekend = [0, 6].includes(date.getUTCDay());

    // Gentle upward trend, weekend dip, plus noise — so the charts look like
    // something rather than a flat band.
    const growth = 1 + (days - d) / days;
    const visitors = Math.max(3, Math.round(project.baseTraffic * growth * (weekend ? 0.55 : 1) * (0.7 + rand() * 0.6)));

    for (let v = 0; v < visitors; v++) {
      const visitorHash = createHash('sha256').update(`${project.id}-${d}-${v}`).digest('hex').slice(0, 32);
      const [referrerGroup, referrerHost] = pick(REFERRERS);
      const [browser, os, device] = pick(BROWSERS);
      const country = pick(COUNTRIES);
      const bucket = device === 'mobile' ? pick(['xs', 'sm']) : pick(BUCKETS.slice(2));

      // Most visits are one page; a few browse. That skew is what makes bounce
      // rate land somewhere believable.
      const pages = rand() < 0.62 ? 1 : between(2, 5);
      const sessionStart = dayStart - between(0, 20) * 3_600_000;

      for (let p = 0; p < pages; p++) {
        rows.push({
          project_id: project.id,
          ts: new Date(sessionStart + p * between(20, 180) * 1000).toISOString(),
          name: 'pageview',
          is_pageview: true,
          path: p === 0 ? pick(project.paths) : pick(project.paths),
          referrer_host: p === 0 ? referrerHost : null,
          referrer_group: p === 0 ? referrerGroup : 'Direct',
          utm_source: rand() < 0.08 ? pick(['newsletter', 'producthunt', 'hn']) : null,
          utm_medium: rand() < 0.08 ? pick(['social', 'email']) : null,
          utm_campaign: rand() < 0.05 ? pick(['launch', 'spring']) : null,
          device, browser, os, country,
          screen_bucket: bucket,
          visitor_hash: visitorHash,
        });
      }

      // Funnel: a slice of visitors sign up, a slice of those buy.
      if (project.slug === 'demo-saas' && rand() < 0.06) {
        rows.push({
          project_id: project.id,
          ts: new Date(sessionStart + 200_000).toISOString(),
          name: 'signup', is_pageview: false, path: '/pricing',
          device, browser, os, country, screen_bucket: bucket,
          visitor_hash: visitorHash, props: { plan: pick(['free', 'pro']) },
        });

        if (rand() < 0.3) {
          rows.push({
            project_id: project.id,
            ts: new Date(sessionStart + 400_000).toISOString(),
            name: 'purchase', is_pageview: false, path: '/pricing',
            device, browser, os, country, screen_bucket: bucket,
            visitor_hash: visitorHash,
            revenue_amount: 29, revenue_currency: 'USD',
            props: { plan: 'pro' },
          });
        }
      }
    }
  }

  // Chunked: one insert of ~10k rows exceeds the request limit.
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('events').insert(rows.slice(i, i + 500));
    if (error) {
      console.error(`  insert failed: ${error.message}`);
      process.exit(1);
    }
  }
  console.log(`  ${project.name}: ${rows.length} events`);
}

// 4. Revenue
console.log('\nGenerating revenue…');
const saas = created.find((p) => p.slug === 'demo-saas');
await db.from('revenue_records').delete().eq('project_id', saas.id);

const revenue = [];
for (let d = days - 1; d >= 0; d--) {
  const dayStart = now - d * DAY;

  // Subscriptions: a growing base billing through the month.
  const subs = Math.round(2 + (days - d) / 12);
  for (let i = 0; i < subs; i++) {
    if (rand() > 0.28) continue;
    revenue.push({
      project_id: saas.id, source: 'stripe', kind: 'subscription',
      amount_cents: 1900, currency: 'USD', amount_base_cents: 1900, base_currency: 'USD',
      occurred_at: new Date(dayStart - between(0, 20) * 3_600_000).toISOString(),
      external_id: `in_seed_${d}_${i}`,
      recurring_interval: 'month', recurring_interval_count: 1,
    });
  }

  // The occasional annual plan, so the demo shows amortized MRR: $190 billed
  // once, contributing ~$15.83/mo for a year instead of spiking one month.
  if (rand() < 0.04) {
    revenue.push({
      project_id: saas.id, source: 'stripe', kind: 'subscription',
      amount_cents: 19000, currency: 'USD', amount_base_cents: 19000, base_currency: 'USD',
      occurred_at: new Date(dayStart - between(0, 20) * 3_600_000).toISOString(),
      external_id: `in_seed_annual_${d}`,
      recurring_interval: 'year', recurring_interval_count: 1,
    });
  }

  // One-off purchases.
  if (rand() < 0.35) {
    revenue.push({
      project_id: saas.id, source: 'stripe', kind: 'one_time',
      amount_cents: 2900, currency: 'USD', amount_base_cents: 2900, base_currency: 'USD',
      occurred_at: new Date(dayStart - between(0, 20) * 3_600_000).toISOString(),
      external_id: `pi_seed_${d}`,
    });
  }

  // Refunds happen. A demo without them would hide the feature that makes the
  // public number trustworthy.
  if (rand() < 0.05) {
    revenue.push({
      project_id: saas.id, source: 'stripe', kind: 'refund',
      amount_cents: -2900, currency: 'USD', amount_base_cents: -2900, base_currency: 'USD',
      occurred_at: new Date(dayStart).toISOString(),
      external_id: `refund_ch_seed_${d}`,
    });
  }
}

// A sponsorship, to exercise the labeled-source path.
revenue.push({
  project_id: saas.id, source: 'sponsorship', kind: 'one_time',
  amount_cents: 50000, currency: 'USD', amount_base_cents: 50000, base_currency: 'USD',
  occurred_at: new Date(now - 12 * DAY).toISOString(),
  label: 'Newsletter sponsor', note: 'Monthly slot',
});

for (let i = 0; i < revenue.length; i += 500) {
  const { error } = await db.from('revenue_records').insert(revenue.slice(i, i + 500));
  if (error) {
    console.error(`  revenue insert failed: ${error.message}`);
    process.exit(1);
  }
}
console.log(`  ${revenue.length} revenue records`);

// 5. Goals
await db.from('goals').delete().eq('owner_id', user.id);
await db.from('goals').insert([
  { owner_id: user.id, project_id: saas.id, metric: 'mrr', target: 100_000, label: '$1k MRR', show_public: true },
  { owner_id: user.id, project_id: null, metric: 'visitors', target: 100_000, label: '100k visitors', show_public: true },
]);
console.log('  2 goals');

// 6. Roll up
console.log('\nRolling up (this is the slow part)…');
const { error: rollupError } = await db.rpc('pulse_backfill', { p_days: days + 1 });
if (rollupError) {
  console.error('  backfill failed:', rollupError.message);
  process.exit(1);
}

const { count } = await db.from('rollups').select('*', { count: 'exact', head: true });
console.log(`  ${count} rollup buckets\n`);

console.log('Done. Sign in at /app as', email);
console.log('Public page: /stats');
