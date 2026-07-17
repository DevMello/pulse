-- ---------------------------------------------------------------------------
-- Pulse — owner-side aggregation, purge grants, and MRR goals
--
-- Fixes three defects found in review:
--
--   1. PostgREST caps every response at 1000 rows (db-max-rows). The dashboard
--      was selecting raw rollup rows and summing them in JavaScript, so any
--      query whose result exceeded the cap was silently truncated and produced
--      a wrong number with no error. rollup_dimensions alone reached 65k rows
--      on 60 days of demo data. Aggregating in SQL fixes the correctness bug
--      and is also dramatically cheaper than shipping 65k rows to Node.
--
--   2. `events` was granted SELECT only, so the one-click purge could never
--      delete anything.
--
--   3. pulse_check_goals had no branch for the 'mrr' metric, so MRR goals could
--      never be marked achieved.
--
-- The aggregate functions below are deliberately SECURITY INVOKER (the default):
-- RLS on rollups / rollup_dimensions still applies, so they can only ever read
-- the caller's own projects. They exist to move a GROUP BY into the database,
-- not to bypass anything.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Aggregation
-- ---------------------------------------------------------------------------

/**
 * Time series across one or more projects, merged per bucket.
 *
 * Returns at most one row per bucket (<=366 for a year of days, <=24 for a day
 * of hours), which is comfortably under the response cap no matter how many
 * projects are summed.
 */
create function pulse_owner_series(
  p_project_ids uuid[],
  p_period text,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  bucket timestamptz,
  pageviews bigint,
  visitors bigint,
  sessions bigint,
  bounces bigint,
  duration_sec bigint,
  events bigint,
  revenue_cents bigint
)
language sql
stable
as $$
  select
    r.bucket,
    sum(r.pageviews)::bigint,
    -- Summing visitors across projects overcounts anyone who visited two of
    -- them. Deduplicating would mean scanning the firehose, which is what
    -- rollups exist to avoid; the UI labels this "visits", not "people".
    sum(r.visitors)::bigint,
    sum(r.sessions)::bigint,
    sum(r.bounces)::bigint,
    sum(r.duration_sec)::bigint,
    sum(r.events)::bigint,
    sum(r.revenue_cents)::bigint
  from rollups r
  where r.project_id = any(p_project_ids)
    and r.period = p_period
    and r.bucket >= p_from
    and r.bucket <= p_to
  group by r.bucket
  order by r.bucket;
$$;

/**
 * Top values for one dimension, aggregated across buckets and projects.
 *
 * The LIMIT is applied after the GROUP BY in the database, so the top-N is
 * computed from every matching row rather than from whatever slice survived a
 * row cap.
 */
create function pulse_owner_breakdown(
  p_project_ids uuid[],
  p_dimension text,
  p_period text,
  p_from timestamptz,
  p_to timestamptz,
  p_limit int default 10
)
returns table (
  value text,
  hits bigint,
  visitors bigint,
  revenue_cents bigint
)
language sql
stable
as $$
  select
    d.value,
    sum(d.hits)::bigint as hits,
    sum(d.visitors)::bigint,
    sum(d.revenue_cents)::bigint
  from rollup_dimensions d
  where d.project_id = any(p_project_ids)
    and d.dimension = p_dimension
    and d.period = p_period
    and d.bucket >= p_from
    and d.bucket <= p_to
  group by d.value
  -- Money dimensions rank by amount; everything else by hits.
  order by case when p_dimension = 'revenue_source'
                then sum(d.revenue_cents) else sum(d.hits) end desc
  limit least(greatest(coalesce(p_limit, 10), 1), 500);
$$;

/**
 * Trailing-30-day subscription revenue — the MRR proxy the dashboard shows.
 *
 * Summed in SQL for the same reason as the others: a SaaS billing 1000+
 * subscriptions a month would overflow the row cap and silently understate its
 * own MRR, which is the single number this product exists to display honestly.
 */
create function pulse_owner_mrr(p_project_ids uuid[])
returns bigint
language sql
stable
as $$
  select coalesce(sum(r.amount_base_cents), 0)::bigint
  from revenue_records r
  where r.project_id = any(p_project_ids)
    and r.kind = 'subscription'
    and r.occurred_at >= now() - interval '30 days';
$$;

grant execute on function pulse_owner_series(uuid[], text, timestamptz, timestamptz) to authenticated;
grant execute on function pulse_owner_breakdown(uuid[], text, text, timestamptz, timestamptz, int) to authenticated;
grant execute on function pulse_owner_mrr(uuid[]) to authenticated;

revoke all on function pulse_owner_series(uuid[], text, timestamptz, timestamptz) from anon;
revoke all on function pulse_owner_breakdown(uuid[], text, text, timestamptz, timestamptz, int) from anon;
revoke all on function pulse_owner_mrr(uuid[]) from anon;

-- ---------------------------------------------------------------------------
-- 2. Purge
--
-- Section 11 promises a one-click purge to honor deletion requests. It was
-- unreachable: `events` had a SELECT grant and a SELECT policy only, so the
-- delete failed with permission denied every time.
--
-- INSERT and UPDATE stay ungranted. The collector writes events through
-- service_role, and an append-only firehose should never be editable by the
-- dashboard — only readable and destroyable.
-- ---------------------------------------------------------------------------

grant delete on events to authenticated;

create policy events_delete_own on events
  for delete to authenticated using (owns_project(project_id));

-- ---------------------------------------------------------------------------
-- 3. MRR goals
--
-- 'mrr' fell through to `else 0`, so an MRR goal could never be achieved: the
-- comparison was always 0 >= target. MRR uses the same trailing-30-day
-- subscription definition the dashboard shows, so the milestone fires exactly
-- when the number the owner is looking at crosses the line.
-- ---------------------------------------------------------------------------

create or replace function pulse_check_goals()
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
      case g.metric
        when 'mrr' then (
          select sum(r.amount_base_cents)
          from revenue_records r
          where r.kind = 'subscription'
            and r.occurred_at >= now() - interval '30 days'
            and (
              (g.project_id is not null and r.project_id = g.project_id)
              or (g.project_id is null and r.project_id in (
                    select id from projects where owner_id = g.owner_id))
            )
        )
        when 'event' then (
          select sum(d.hits)
          from rollup_dimensions d
          where d.period = 'day'
            and d.dimension = 'event'
            and d.value = g.event_name
            and (
              (g.project_id is not null and d.project_id = g.project_id)
              or (g.project_id is null and d.project_id in (
                    select id from projects where owner_id = g.owner_id))
            )
        )
        else (
          select case g.metric
            when 'revenue'   then sum(r.revenue_cents)
            when 'visitors'  then sum(r.visitors)
            when 'pageviews' then sum(r.pageviews)
          end
          from rollups r
          where r.period = 'day'
            and (
              (g.project_id is not null and r.project_id = g.project_id)
              or (g.project_id is null and r.project_id in (
                    select id from projects where owner_id = g.owner_id))
            )
        )
      end
    ), 0) >= g.target;
end;
$$;

revoke all on function pulse_check_goals() from anon, authenticated;
