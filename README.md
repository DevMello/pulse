# Pulse

**Privacy-first analytics with revenue tracking and a public stats page. Runs on your own Vercel + Supabase. ~1 KB script, no cookies, no consent banner.**

Pulse does three jobs:

1. **Collects** pageviews, custom events, and revenue across all your projects from one tiny script tag.
2. **Shows you** everything in a private dashboard — traffic, revenue, funnels, realtime, portfolio roll-up.
3. **Publishes** a read-only stats page where anyone can see your traffic and revenue. A build-in-public flex that doubles as social proof.

The data lives in **your** Supabase. Nothing leaves your infrastructure. There's no vendor, no per-event billing, and no third-party pixel touching your visitors.

```html
<script defer data-key="YOUR_KEY" src="https://your-pulse.vercel.app/px.js"></script>
```

That's the whole integration.

---

## Why another analytics tool

Plausible and Umami already do cookieless analytics well. Pulse exists for one specific person: the developer with a handful of side projects who wants **traffic and revenue on the same page**, published openly, running free on infrastructure they already have.

| | Pulse |
|---|---|
| Script size | **928 B** gzipped (measured, enforced in CI) |
| Cookies | None. Not "essential cookies" — none. |
| Consent banner | Not needed by design |
| Revenue | First-class: Stripe webhooks, SDK events, manual entry |
| Public page | Built in, per-metric visibility toggles |
| Cost at indie scale | $0 (Vercel Hobby + Supabase Free) |
| Your data | In your Postgres. Export or delete it any time. |

---

## Deploy

You need a [Supabase](https://supabase.com) project and a [Vercel](https://vercel.com) account. Both free tiers are enough.

### 1. Fork and deploy

Fork this repo, import it into Vercel, and set two environment variables:

```sh
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
```

Both come from **Supabase → Project Settings → API**. The anon key is safe to expose — Row Level Security is what protects your data, and that's exactly why it can be public.

You'll also want a third, so the collector can write events:

```sh
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...   # server-only, never prefix with NEXT_PUBLIC_
```

Without it, Pulse runs read-only. See [.env.example](.env.example) for everything else (Stripe, currency, cron).

### 2. Run the migrations

Either paste the files in [`supabase/migrations/`](supabase/migrations) into the Supabase SQL editor in filename order, or use the CLI:

```sh
supabase link --project-ref xxxxxxxx
supabase db push
```

This creates the schema, the RLS policies, the rollup functions, and three `pg_cron` jobs (rollups every 5 min, retention nightly, goal checks every 15 min). No further scheduling setup is needed.

### 3. Claim your instance

Sign-in is email + password — no email round trip — so turn off **Confirm email** in the Supabase dashboard (Authentication → Providers → Email) first; otherwise the one-time account creation waits on a confirmation link.

Then visit `/app`, choose **First run? Create the owner account**, and set your email and password. **The first account to sign up becomes the owner; every later signup is refused.** To be explicit about who's allowed, set the allow-list on the database:

```sql
alter database postgres set pulse.owner_emails = 'you@example.com';
```

This is enforced by a database trigger rather than app code, so a bug in a route can't hand someone else your dashboard.

### 4. Add a project, paste the snippet

Create a project, copy the snippet, paste it before `</body>`. Your first pageview should land within seconds.

---

## Try it before pointing it at a real site

```sh
npm install
cp .env.example .env.local     # fill in your Supabase values
node scripts/seed.mjs --email you@example.com
npm run dev
```

That generates two projects with 60 days of realistic traffic (weekday/weekend shape, growth trend), subscription and one-off revenue, refunds, and goals — then rolls it all up. Sign in at `/app`, and see `/stats` for the public view.

---

## How it works

Everything is one Next.js app on Vercel plus one Supabase project. No Redis, no queue, no separate job runner.

```
  visitor's browser                your Vercel                    your Supabase
 ┌──────────────────┐         ┌──────────────────────┐       ┌────────────────────┐
 │  px.js (928 B)   │──POST──▶│  /api/event (edge)   │──────▶│  events (firehose) │
 │  no cookies      │         │  • UA → device/browser│       │       │            │
 └──────────────────┘         │  • IP → country, drop │       │       │ pg_cron    │
                              │  • bot filter, dedup  │       │       ▼ every 5m   │
 ┌──────────────────┐         │  • daily visitor hash │       │  rollups (forever) │
 │  Stripe          │──POST──▶│  /api/webhooks/stripe │──────▶│  revenue_records   │
 └──────────────────┘         └──────────────────────┘       └────────┬───────────┘
                                                                      │
                              ┌──────────────────────┐                │
                              │  /app   (dashboard)  │◀──── RLS ──────┤
                              │  /stats (public,     │◀── RPC only ───┘
                              │          edge-cached)│
                              └──────────────────────┘
```

**Three tiers of data.** Raw `events` are the source of truth and get pruned on your retention schedule. `rollups` are pre-computed summaries, kept forever, and back every screen. Because nothing reads the firehose except realtime, your charts survive pruning and your database stays inside the free tier for a long time.

**Three principals.** `service_role` (collector, webhooks) bypasses RLS and is server-only. `authenticated` (you) reads only your own rows. `anon` (the public page) has **no table access at all** — it can only call security-definer functions that apply your visibility toggles before returning a single byte. A metric you've hidden is never serialized, so it can't be recovered from the network tab.

**The public page is static.** `/stats` and `/stats/[days]` are prerendered with 5-minute ISR. A million visitors hit the CDN; Postgres sees one query every five minutes.

---

## Privacy

No cookies. No localStorage identifiers. No fingerprinting. No cross-site tracking. No personal data.

Unique visitors are counted with a **salted daily-rotating hash**:

```
sha256( daily_salt + project_id + ip + user_agent )
```

Every input except the salt is already in an ordinary HTTP request, and none of them is stored — the IP is used to compute this and look up a country, then discarded.

The salt is random per UTC day and **destroyed after 48 hours**. Once it's gone, that day's hashes cannot be recomputed or reversed by anyone — including you, with full access to your own database. That's what makes "we can't track you across days" a property of the system rather than a promise. `project_id` is in the hash so the same visitor can't be correlated across two sites on one Pulse instance.

The honest cost, which the public page states openly:

- Two people behind one NAT on identical devices count once.
- One person on a phone and a laptop counts twice.
- Counting resets at UTC midnight.

**Do you need a cookie banner?** No. GDPR/PECR consent requirements are triggered by storing or accessing information on a device, and by processing personal data. Pulse does neither. (This is not legal advice — but it's the same basis Plausible and Umami operate on.)

---

## Revenue

Two paths, one pipeline.

**Stripe** — point a webhook at `/api/webhooks/stripe` subscribing to `payment_intent.succeeded`, `invoice.paid`, `charge.refunded`, and `charge.dispute.*`. Signatures are verified; redelivery is idempotent. Subscriptions and one-offs are split. Refunds and lost disputes are stored as negative amounts and **subtract from your totals**, so the public number stays honest.

**SDK / manual** — anything without an API:

```js
pulse('purchase', { revenue: { amount: 29, currency: 'USD' } });
```

…or type it into the dashboard, with labeled sources for ad networks, affiliates, and sponsorships.

Money is stored in **integer minor units** in the currency actually charged, never a float. Zero-decimal currencies (JPY, KRW) and three-decimal ones (KWD, BHD) are handled correctly. Set `PULSE_FX_RATES` to normalize mixed currencies into one display total; unconverted currencies are flagged in the UI rather than silently misreported.

**MRR is a trailing-30-day proxy**, labeled as such everywhere it appears. Pulse stores payments, not subscription objects, so an annual plan lands in the month it's billed. Calling that "MRR" without the caveat would be the vanity inflation this project exists to avoid.

---

## The public page

`/stats` shows exactly what you allow, per project:

- Visitors, pageviews, top pages, sources, countries, live count — each individually toggleable.
- **Revenue is off by default** and toggles separately.
- Number styles: exact (`12,481`), rounded (`12,500`), bucketed (`10k–25k`), or relative (`+18%` trends only, no absolute figures).

Masking happens in the database, not in React — hidden means never sent.

Embeddable badge, works in a README:

```html
<img src="https://your-pulse.vercel.app/api/badge/your-slug" alt="Live visitors" height="20">
```

---

## Customizing

| What | Where |
|---|---|
| Colors, fonts | [`src/app/globals.css`](src/app/globals.css) — one `@theme` block |
| Public page copy | [`src/app/stats/`](src/app/stats) |
| Methodology note | [`src/app/stats/methodology.tsx`](src/app/stats/methodology.tsx) |
| Bot list | [`src/lib/enrich/bots.ts`](src/lib/enrich/bots.ts) |
| Referrer grouping | [`src/lib/enrich/referrer.ts`](src/lib/enrich/referrer.ts) |
| Tracker | [`src/tracker/px.js`](src/tracker/px.js) — `npm run size` to check the budget |

---

## Scripts

```sh
npm run dev            # build tracker + dev server
npm run build          # production build
npm run size           # tracker size report
npm test               # unit tests
npm run typecheck      # tsc --noEmit
node scripts/seed.mjs --email you@example.com   # demo data
```

---

## Where the limits are

Honest about the ceiling, per Section 13 of the design:

- **Volume.** At millions of events/day, raw storage grows and heavy queries get expensive on Postgres. The mitigations are already here — aggressive rollups, short raw retention, dashboards that only read summaries. If you truly outgrow it, the next step is a columnar store (ClickHouse) *behind the same collector*. That's a "you have a hit product" problem, not a day-one one.
- **Edge function limits.** Ingestion is tiny and fast, but a huge spike on the free tier can hit usage caps. The fire-and-forget collector and the static public page keep this contained.
- **Rate limiting is per-isolate.** Without Redis there's no shared counter, so the collector's limiter is a spike damper, not a quota. The domain allow-list is what actually stops forged events.
- **Realtime is a 10s poll**, not a stream. At indie scale that's indistinguishable, and it can't fall behind.

---

## License

MIT. Fork it, run it, sell things with it, contribute back if you like.
