-- ---------------------------------------------------------------------------
-- Pulse — core schema
--
-- Three tiers of data, in decreasing volume and increasing lifetime:
--   1. events            append-only firehose, pruned on a retention schedule
--   2. rollups/*         pre-computed summaries, kept indefinitely, power all UI
--   3. projects/settings  configuration
--
-- Nothing in the dashboard or the public page ever scans `events` except the
-- realtime widgets, which only look at the last few minutes.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Owner
-- ---------------------------------------------------------------------------

-- Pulse is single-tenant by design: one owner, many projects. `owners` exists
-- so a fork can grow to multi-tenant without reshaping every table.
create table owners (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text,
  -- The public page's global chrome (per-project exposure lives elsewhere).
  public_title text not null default 'Open Metrics',
  public_bio   text,
  public_theme jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------

create type bot_filter_level as enum ('off', 'standard', 'strict');

create table projects (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references owners (id) on delete cascade,
  name           text not null,
  -- URL-safe identifier used on the public page: /stats/<slug>
  slug           text not null,
  -- Public, safe-to-expose key that appears in the script tag. Not a secret;
  -- the domain allow-list is what actually prevents spoofed ingestion.
  ingest_key     text not null default encode(gen_random_bytes(12), 'hex'),
  -- Hostnames allowed to send events. Empty array = accept any origin, which
  -- we warn about in the UI.
  domains        text[] not null default '{}',
  timezone       text not null default 'UTC',
  -- Raw events older than this are pruned by cron. Rollups are never pruned.
  retention_days int not null default 180,
  bot_filter     bot_filter_level not null default 'standard',
  -- Paths never recorded, glob-ish: exact match or trailing '*' prefix match.
  excluded_paths text[] not null default '{}',
  -- When true the tracker drops events from DNT/GPC browsers.
  respect_dnt    boolean not null default false,
  archived       boolean not null default false,
  created_at     timestamptz not null default now(),

  constraint projects_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$'),
  constraint projects_retention_range check (retention_days between 1 and 3650)
);

create unique index projects_slug_key on projects (slug);
create unique index projects_ingest_key_key on projects (ingest_key);
create index projects_owner_idx on projects (owner_id) where not archived;

-- What the public page is allowed to reveal, per project. Split from `projects`
-- so the public read path touches a table that holds no secrets at all.
create table project_public_settings (
  project_id     uuid primary key references projects (id) on delete cascade,
  is_public      boolean not null default false,
  show_visitors  boolean not null default true,
  show_pageviews boolean not null default true,
  -- Revenue is opt-in, separately from everything else, and defaults to hidden.
  show_revenue   boolean not null default false,
  show_top_pages boolean not null default true,
  show_sources   boolean not null default true,
  show_countries boolean not null default true,
  show_live      boolean not null default true,
  -- exact    → 12,481
  -- rounded  → 12.5k
  -- bucketed → 10k–25k
  -- relative → "+18% vs last period" only, no absolute figures
  number_style   text not null default 'exact',

  constraint number_style_valid check (number_style in ('exact', 'rounded', 'bucketed', 'relative'))
);

-- ---------------------------------------------------------------------------
-- Events — the raw firehose
-- ---------------------------------------------------------------------------

create table events (
  id             bigint generated always as identity primary key,
  project_id     uuid not null references projects (id) on delete cascade,
  ts             timestamptz not null default now(),

  -- 'pageview' for auto-tracked views, otherwise a custom event name.
  name           text not null,
  is_pageview    boolean not null default false,

  path           text,
  -- Referrer is stored host-only; the full URL can carry PII in query strings.
  referrer_host  text,
  -- Normalized bucket: 'Google', 'Hacker News', 'Direct', … See lib/referrer.
  referrer_group text,

  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  utm_term       text,
  utm_content    text,

  device         text,
  browser        text,
  os             text,
  country        text,
  region         text,
  -- Bucketed, never exact pixels: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  screen_bucket  text,

  -- Salted, daily-rotating, non-reversible. The salt is destroyed after 48h,
  -- at which point this column cannot be linked back to anyone even in
  -- principle. This is the only visitor signal that exists.
  visitor_hash   text,

  -- Revenue attached directly to an event via the SDK (Section 4.6). The
  -- normalized money record in `revenue_records` is the source of truth for
  -- reporting; this column is the raw claim as it arrived.
  revenue_amount numeric(14, 4),
  revenue_currency text,

  props          jsonb
);

-- Every dashboard/realtime query is "this project, this time window".
create index events_project_ts_idx on events (project_id, ts desc);
-- Rollups group by visitor within a window.
create index events_project_visitor_idx on events (project_id, ts, visitor_hash) where visitor_hash is not null;
-- Custom-event and funnel lookups.
create index events_project_name_ts_idx on events (project_id, name, ts desc) where not is_pageview;

-- ---------------------------------------------------------------------------
-- Visitor salts
--
-- The privacy guarantee lives here. A random salt per UTC day means the same
-- visitor hashes differently tomorrow, so cross-day tracking is impossible.
-- Cron deletes salts older than 2 days, making yesterday's hashes permanently
-- unrecomputable — even by us, even with the database.
-- ---------------------------------------------------------------------------

create table visitor_salts (
  day        date primary key,
  salt       text not null default encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz not null default now()
);

-- Returns today's salt, minting it on first use. Security definer so the
-- collector can call it without the salt table being readable at large.
create function current_visitor_salt()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salt text;
begin
  insert into visitor_salts (day)
  values (current_date)
  on conflict (day) do nothing;

  select salt into v_salt from visitor_salts where day = current_date;
  return v_salt;
end;
$$;

-- ---------------------------------------------------------------------------
-- Revenue
-- ---------------------------------------------------------------------------

create type revenue_source as enum (
  'stripe', 'paddle', 'lemonsqueezy', 'sdk', 'manual', 'ads', 'affiliate', 'sponsorship'
);

create type revenue_kind as enum ('one_time', 'subscription', 'refund', 'dispute');

create table revenue_records (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects (id) on delete cascade,
  source       revenue_source not null,
  kind         revenue_kind not null default 'one_time',

  -- Minor units (cents) in the currency actually charged. Integer math only —
  -- money never touches a float.
  amount_cents  bigint not null,
  currency      text not null,
  -- The same money converted to the owner's display currency, for combined
  -- totals across currencies. Recomputed on write, never trusted for exactness.
  amount_base_cents bigint not null,
  base_currency text not null default 'USD',

  occurred_at  timestamptz not null default now(),

  -- Provider's id (charge/invoice/payment id). The unique index on it is what
  -- makes webhook redelivery idempotent.
  external_id  text,
  -- Links SDK revenue back to the event that produced it.
  event_id     bigint references events (id) on delete set null,
  -- Free-text grouping for sources with no API: "Carbon Ads", "Amazon Affiliates".
  label        text,
  note         text,
  created_at   timestamptz not null default now()
);

-- Refunds and disputes are stored as negative amounts so that every revenue
-- question is a plain SUM and can never double-count or forget to subtract.
alter table revenue_records add constraint revenue_sign_matches_kind check (
  (kind in ('refund', 'dispute') and amount_cents <= 0) or
  (kind in ('one_time', 'subscription') and amount_cents >= 0)
);

create unique index revenue_external_id_key
  on revenue_records (source, external_id) where external_id is not null;
create index revenue_project_time_idx on revenue_records (project_id, occurred_at desc);

-- Maps an incoming Stripe object to a project. Checked most-specific first:
-- price → product → account.
create table revenue_mappings (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references owners (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  source     revenue_source not null default 'stripe',
  -- 'account' | 'product' | 'price'
  match_type text not null,
  -- The Stripe account/product/price id. Null match_value with match_type
  -- 'account' is the catch-all default project.
  match_value text,
  created_at timestamptz not null default now(),

  constraint match_type_valid check (match_type in ('account', 'product', 'price'))
);

create unique index revenue_mappings_unique
  on revenue_mappings (owner_id, source, match_type, coalesce(match_value, ''));

-- ---------------------------------------------------------------------------
-- Rollups
--
-- Two tables: headline scalars per bucket, and a tall table for every
-- breakdown dimension. Dashboards and the public page read only these.
-- ---------------------------------------------------------------------------

create table rollups (
  project_id   uuid not null references projects (id) on delete cascade,
  -- 'hour' | 'day'
  period       text not null,
  bucket       timestamptz not null,

  pageviews    integer not null default 0,
  visitors     integer not null default 0,
  sessions     integer not null default 0,
  -- Sessions with exactly one pageview. bounce_rate = bounces / sessions.
  bounces      integer not null default 0,
  -- Summed session durations in seconds; avg = total / (sessions - bounces).
  duration_sec bigint not null default 0,
  events       integer not null default 0,
  revenue_cents bigint not null default 0,

  computed_at  timestamptz not null default now(),

  primary key (project_id, period, bucket),
  constraint rollups_period_valid check (period in ('hour', 'day'))
);

create index rollups_period_bucket_idx on rollups (period, bucket desc);

create table rollup_dimensions (
  project_id  uuid not null references projects (id) on delete cascade,
  period      text not null,
  bucket      timestamptz not null,
  -- 'path' | 'referrer' | 'country' | 'browser' | 'os' | 'device'
  -- | 'utm_source' | 'utm_medium' | 'utm_campaign' | 'event' | 'entry' | 'exit'
  dimension   text not null,
  value       text not null,

  -- Count of matching things, whose unit depends on the dimension: pageviews
  -- for 'path', sessions for 'entry'/'exit', event fires for 'event'. One
  -- generic column beats a sparse one per dimension.
  hits        integer not null default 0,
  visitors    integer not null default 0,
  revenue_cents bigint not null default 0,

  primary key (project_id, period, bucket, dimension, value),
  constraint rollup_dimensions_period_valid check (period in ('hour', 'day'))
);

create index rollup_dimensions_lookup_idx
  on rollup_dimensions (project_id, dimension, period, bucket desc);

-- ---------------------------------------------------------------------------
-- Goals & milestones
-- ---------------------------------------------------------------------------

create table goals (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references owners (id) on delete cascade,
  -- Null = portfolio-wide goal across every project.
  project_id uuid references projects (id) on delete cascade,
  -- 'mrr' | 'revenue' | 'visitors' | 'pageviews' | 'event'
  metric     text not null,
  -- Cents for money metrics, plain count otherwise.
  target     bigint not null,
  label      text,
  -- For metric = 'event'
  event_name text,
  show_public boolean not null default false,
  achieved_at timestamptz,
  created_at timestamptz not null default now(),

  constraint goals_metric_valid check (metric in ('mrr', 'revenue', 'visitors', 'pageviews', 'event'))
);

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------

create table alerts (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references owners (id) on delete cascade,
  project_id uuid references projects (id) on delete cascade,
  -- 'traffic_spike' | 'revenue_received' | 'revenue_threshold' | 'traffic_drop'
  kind       text not null,
  -- Meaning depends on kind: multiplier for spikes, cents for thresholds.
  threshold  numeric,
  -- 'email' | 'webhook'
  channel    text not null default 'email',
  destination text,
  enabled    boolean not null default true,
  last_fired_at timestamptz,
  created_at timestamptz not null default now(),

  constraint alerts_kind_valid check (kind in ('traffic_spike', 'traffic_drop', 'revenue_received', 'revenue_threshold')),
  constraint alerts_channel_valid check (channel in ('email', 'webhook'))
);

-- ---------------------------------------------------------------------------
-- Integrations (provider credentials/state, owner-only)
-- ---------------------------------------------------------------------------

create table integrations (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references owners (id) on delete cascade,
  provider    text not null,
  -- Provider account id, e.g. Stripe's acct_…
  account_id  text,
  -- Never contains a live secret: keys live in env vars. This is display state
  -- (connected_at, account name, last webhook seen).
  meta        jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now(),

  constraint integrations_provider_valid check (provider in ('stripe', 'paddle', 'lemonsqueezy'))
);

create unique index integrations_owner_provider_key on integrations (owner_id, provider);
