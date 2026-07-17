-- ---------------------------------------------------------------------------
-- Pulse — aggregation, retention, and the scheduled jobs that drive them
--
-- pulse_rollup() is idempotent: re-running it for a window recomputes that
-- window from the raw events and overwrites the result. That property is what
-- lets cron re-roll recent windows to absorb late-arriving events without any
-- bookkeeping about what has already been counted.
-- ---------------------------------------------------------------------------

-- Session inactivity gap. Two events from one visitor more than this far apart
-- are two sessions. 30 minutes is the industry convention (GA, Plausible).
create function pulse_session_gap() returns interval
  language sql immutable as $$ select interval '30 minutes' $$;

-- ---------------------------------------------------------------------------
-- pulse_rollup(period, from, to)
--
-- Recomputes every bucket of `period` that starts in [from, to) for every
-- project. Buckets are aligned to each project's own timezone, so a project in
-- Asia/Tokyo gets Tokyo days.
-- ---------------------------------------------------------------------------
create function pulse_rollup(p_period text, p_from timestamptz, p_to timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_period not in ('hour', 'day') then
    raise exception 'pulse_rollup: invalid period %', p_period;
  end if;

  drop table if exists _pulse_ev;
  drop table if exists _pulse_sess;

  -- Sessionization needs to see slightly before the window, otherwise a
  -- session already in progress at p_from looks like a brand new one.
  create temp table _pulse_ev on commit drop as
  with ext as (
    select
      e.id, e.project_id, e.ts, e.name, e.is_pageview, e.path,
      e.referrer_group, e.utm_source, e.utm_medium, e.utm_campaign,
      e.country, e.browser, e.os, e.device, e.visitor_hash,
      p.timezone,
      (date_trunc(p_period, e.ts at time zone p.timezone) at time zone p.timezone) as bucket
    from events e
    join projects p on p.id = e.project_id
    where e.ts >= p_from - pulse_session_gap()
      and e.ts <  p_to
  ),
  marked as (
    select ext.*,
      case
        when visitor_hash is null then 1
        when lag(ts) over w is null then 1
        when ts - lag(ts) over w > pulse_session_gap() then 1
        else 0
      end as is_session_start
    from ext
    window w as (partition by project_id, visitor_hash order by ts)
  )
  select marked.*,
    sum(is_session_start) over (
      partition by project_id, visitor_hash
      order by ts
      rows between unbounded preceding and current row
    ) as session_seq
  from marked;

  create index on _pulse_ev (project_id, bucket);

  -- One row per session, bucketed by when the session *started*.
  create temp table _pulse_sess on commit drop as
  select
    project_id,
    visitor_hash,
    session_seq,
    min(bucket)                                                as bucket,
    min(ts)                                                    as started_at,
    max(ts)                                                    as ended_at,
    count(*) filter (where is_pageview)                        as pageviews,
    (array_agg(path order by ts)      filter (where is_pageview and path is not null))[1] as entry_path,
    (array_agg(path order by ts desc) filter (where is_pageview and path is not null))[1] as exit_path
  from _pulse_ev
  where visitor_hash is not null
  group by project_id, visitor_hash, session_seq
  having min(ts) >= p_from;

  -- -------------------------------------------------------------------------
  -- Scalar rollups
  -- -------------------------------------------------------------------------
  with traffic as (
    select
      project_id,
      bucket,
      count(*) filter (where is_pageview)      as pageviews,
      count(*) filter (where not is_pageview)  as events,
      count(distinct visitor_hash)             as visitors
    from _pulse_ev
    where ts >= p_from
    group by project_id, bucket
  ),
  sessions as (
    select
      project_id,
      bucket,
      count(*)                                       as sessions,
      count(*) filter (where pageviews <= 1)         as bounces,
      coalesce(sum(extract(epoch from ended_at - started_at))::bigint, 0) as duration_sec
    from _pulse_sess
    group by project_id, bucket
  ),
  revenue as (
    select
      r.project_id,
      (date_trunc(p_period, r.occurred_at at time zone p.timezone) at time zone p.timezone) as bucket,
      sum(r.amount_base_cents)::bigint as revenue_cents
    from revenue_records r
    join projects p on p.id = r.project_id
    where r.occurred_at >= p_from and r.occurred_at < p_to
    group by 1, 2
  ),
  merged as (
    select
      coalesce(t.project_id, s.project_id, rv.project_id) as project_id,
      coalesce(t.bucket,     s.bucket,     rv.bucket)     as bucket,
      coalesce(t.pageviews, 0)    as pageviews,
      coalesce(t.visitors, 0)     as visitors,
      coalesce(t.events, 0)       as events,
      coalesce(s.sessions, 0)     as sessions,
      coalesce(s.bounces, 0)      as bounces,
      coalesce(s.duration_sec, 0) as duration_sec,
      coalesce(rv.revenue_cents, 0) as revenue_cents
    from traffic t
    full outer join sessions s  on s.project_id = t.project_id and s.bucket = t.bucket
    full outer join revenue rv  on rv.project_id = coalesce(t.project_id, s.project_id)
                               and rv.bucket     = coalesce(t.bucket, s.bucket)
  )
  insert into rollups (project_id, period, bucket, pageviews, visitors, sessions,
                       bounces, duration_sec, events, revenue_cents, computed_at)
  select project_id, p_period, bucket, pageviews, visitors, sessions,
         bounces, duration_sec, events, revenue_cents, now()
  from merged
  where project_id is not null and bucket is not null
  on conflict (project_id, period, bucket) do update set
    pageviews     = excluded.pageviews,
    visitors      = excluded.visitors,
    sessions      = excluded.sessions,
    bounces       = excluded.bounces,
    duration_sec  = excluded.duration_sec,
    events        = excluded.events,
    revenue_cents = excluded.revenue_cents,
    computed_at   = now();

  -- -------------------------------------------------------------------------
  -- Dimension rollups
  --
  -- Recomputed destructively for the window: a value that dropped to zero must
  -- disappear rather than linger at its old count.
  -- -------------------------------------------------------------------------
  delete from rollup_dimensions rd
  where rd.period = p_period
    and rd.bucket >= (select min(bucket) from _pulse_ev where ts >= p_from)
    and rd.bucket <= (select max(bucket) from _pulse_ev where ts >= p_from);

  -- Event-shaped dimensions.
  insert into rollup_dimensions (project_id, period, bucket, dimension, value, hits, visitors)
  select
    e.project_id, p_period, e.bucket, d.dim, d.val,
    count(*)::int,
    count(distinct e.visitor_hash)::int
  from _pulse_ev e
  cross join lateral (values
    ('path',         case when e.is_pageview then e.path else null end),
    ('referrer',     case when e.is_pageview then e.referrer_group else null end),
    ('country',      e.country),
    ('browser',      e.browser),
    ('os',           e.os),
    ('device',       e.device),
    ('utm_source',   e.utm_source),
    ('utm_medium',   e.utm_medium),
    ('utm_campaign', e.utm_campaign),
    ('event',        case when e.is_pageview then null else e.name end)
  ) as d(dim, val)
  where e.ts >= p_from
    and d.val is not null and d.val <> ''
  group by e.project_id, e.bucket, d.dim, d.val
  on conflict (project_id, period, bucket, dimension, value) do update set
    hits = excluded.hits, visitors = excluded.visitors;

  -- Session-shaped dimensions (entry/exit pages).
  insert into rollup_dimensions (project_id, period, bucket, dimension, value, hits, visitors)
  select
    s.project_id, p_period, s.bucket, d.dim, d.val,
    count(*)::int,
    count(distinct s.visitor_hash)::int
  from _pulse_sess s
  cross join lateral (values
    ('entry', s.entry_path),
    ('exit',  s.exit_path)
  ) as d(dim, val)
  where d.val is not null and d.val <> ''
  group by s.project_id, s.bucket, d.dim, d.val
  on conflict (project_id, period, bucket, dimension, value) do update set
    hits = excluded.hits, visitors = excluded.visitors;

  -- Revenue by source, so the dashboard can break money down the same way it
  -- breaks down traffic.
  insert into rollup_dimensions (project_id, period, bucket, dimension, value, hits, revenue_cents)
  select
    r.project_id, p_period,
    (date_trunc(p_period, r.occurred_at at time zone p.timezone) at time zone p.timezone),
    'revenue_source',
    coalesce(r.label, r.source::text),
    count(*)::int,
    sum(r.amount_base_cents)::bigint
  from revenue_records r
  join projects p on p.id = r.project_id
  where r.occurred_at >= p_from and r.occurred_at < p_to
  group by 1, 3, 5
  on conflict (project_id, period, bucket, dimension, value) do update set
    hits = excluded.hits, revenue_cents = excluded.revenue_cents;

  drop table if exists _pulse_ev;
  drop table if exists _pulse_sess;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- pulse_rollup_recent()
--
-- What cron actually calls. Re-rolls a trailing window rather than only the
-- last complete bucket, so events that arrive late (offline queue, retries,
-- a webhook replay) still land in the right bucket.
-- ---------------------------------------------------------------------------
create function pulse_rollup_recent()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pulse_rollup('hour', date_trunc('hour', now()) - interval '3 hours', now() + interval '1 hour');
  perform pulse_rollup('day',  date_trunc('day',  now()) - interval '2 days',  now() + interval '1 day');
end;
$$;

-- ---------------------------------------------------------------------------
-- pulse_backfill(days)
--
-- One-shot rebuild of every rollup from raw events. Safe to run any time;
-- used after importing data or changing rollup logic.
-- ---------------------------------------------------------------------------
create function pulse_backfill(p_days int default 400)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d date;
begin
  -- Chunked a day at a time to keep each statement's working set small enough
  -- for a free-tier instance.
  for d in
    select generate_series(current_date - p_days, current_date, interval '1 day')::date
  loop
    perform pulse_rollup('day',  d::timestamptz, (d + 1)::timestamptz);
    perform pulse_rollup('hour', d::timestamptz, (d + 1)::timestamptz);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- pulse_prune()
--
-- Retention. Deletes raw events past each project's window and destroys old
-- visitor salts. Rollups are never touched, so history survives the pruning —
-- that is the whole reason rollups exist.
-- ---------------------------------------------------------------------------
create function pulse_prune()
returns table (deleted_events bigint, deleted_salts bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_events bigint := 0;
  v_salts  bigint := 0;
begin
  with doomed as (
    delete from events e
    using projects p
    where p.id = e.project_id
      and e.ts < now() - make_interval(days => p.retention_days)
    returning 1 as x
  )
  select count(*) into v_events from doomed;

  -- Salts older than 2 days are destroyed. Once a salt is gone, the visitor
  -- hashes computed with it can never be recomputed or reversed by anyone —
  -- including the operator. This is the mechanism behind "we cannot track you
  -- across days", and it is why it is a real guarantee and not a promise.
  with doomed as (
    delete from visitor_salts
    where day < current_date - 2
    returning 1 as x
  )
  select count(*) into v_salts from doomed;

  return query select v_events, v_salts;
end;
$$;

-- ---------------------------------------------------------------------------
-- Goal achievement stamping — powers the "$1k MRR reached 🎉" milestone.
-- ---------------------------------------------------------------------------
create function pulse_check_goals()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update goals g
  set achieved_at = now()
  where g.achieved_at is null
    and g.target > 0
    and coalesce((
      select case g.metric
        when 'revenue'  then sum(r.revenue_cents)
        when 'visitors' then sum(r.visitors)
        when 'pageviews' then sum(r.pageviews)
        else 0
      end
      from rollups r
      where r.period = 'day'
        and (g.project_id is null or r.project_id = g.project_id)
        and (g.project_id is not null or r.project_id in (
              select id from projects where owner_id = g.owner_id))
    ), 0) >= g.target;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduling
--
-- Default: Supabase pg_cron, so a fork works with zero Vercel configuration.
-- Vercel Cron is an alternative — see /api/cron/* and vercel.json. Run one or
-- the other, not both (they are idempotent, so overlap is harmless, just
-- wasteful).
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.schedule(
  'pulse-rollup',
  '*/5 * * * *',
  $$ select pulse_rollup_recent(); $$
);

select cron.schedule(
  'pulse-prune',
  '17 4 * * *',
  $$ select pulse_prune(); $$
);

select cron.schedule(
  'pulse-goals',
  '*/15 * * * *',
  $$ select pulse_check_goals(); $$
);
