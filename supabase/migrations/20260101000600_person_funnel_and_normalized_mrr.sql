-- ---------------------------------------------------------------------------
-- Pulse — per-person funnels and normalized MRR
--
-- Two honesty upgrades, both replacing a labeled approximation with the real
-- quantity:
--
--   1. The funnel counted events, not people: "40% reached step 2" meant step 2
--      fired 40% as often as step 1, not that 40% of the humans who did step 1
--      went on to do step 2. pulse_owner_funnel walks raw events one visitor at
--      a time and counts visitors who completed the steps *in order*.
--
--   2. MRR was "subscription payments in the last 30 days", so an annual plan
--      landed entirely in the month it was billed. Each payment now records the
--      billing interval it covers, and MRR normalizes: a $120/year payment
--      contributes $10 for each of the twelve months it spans, and stops
--      counting the moment its paid period lapses.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Per-person funnel
-- ---------------------------------------------------------------------------

/**
 * How far into the step sequence one visitor's ordered events got.
 *
 * Greedy in-order match: each event can only advance the sequence to its next
 * step, so [signup, purchase] against steps [purchase, signup] is depth 1, not
 * 2 — order is the thing an event-count ratio could never see.
 */
create function pulse_funnel_depth(p_names text[], p_steps text[])
returns int
language plpgsql
immutable
as $$
declare
  v_depth int := 0;
  v_name text;
begin
  foreach v_name in array p_names loop
    exit when v_depth >= array_length(p_steps, 1);
    if v_name = p_steps[v_depth + 1] then
      v_depth := v_depth + 1;
    end if;
  end loop;
  return v_depth;
end;
$$;

/**
 * Per-visitor funnel over raw events.
 *
 * This is the one dashboard read allowed to touch `events`, because it is the
 * one question rollups cannot answer: sequencing requires per-visitor order,
 * and rollups deliberately store none. The costs that implies are real and
 * inherited honestly:
 *
 *   - Only events still inside the retention window exist to be walked; the
 *     UI says so when the selected range reaches past the cutoff.
 *   - visitor_hash rotates at UTC midnight by design, so a conversion that
 *     spans two days counts as a drop-off plus a partial. Within a day the
 *     sequencing is exact.
 *
 * Row 0 is the implicit top of the funnel: distinct visitors over the range,
 * from the same raw events, so every ratio in the funnel divides likes by
 * likes.
 *
 * SECURITY INVOKER: RLS on `events` scopes it to the caller's own projects.
 */
create function pulse_owner_funnel(
  p_project_ids uuid[],
  p_steps text[],
  p_from timestamptz,
  p_to timestamptz
)
returns table (step int, visitors bigint)
language plpgsql
stable
as $$
-- The RETURNS TABLE names double as plpgsql variables, which would otherwise
-- make bare `step` in the body ambiguous. Columns win.
#variable_conflict use_column
begin
  if array_length(p_steps, 1) is null or array_length(p_steps, 1) > 10 then
    raise exception 'funnel takes 1 to 10 steps';
  end if;

  return query
  with per_visitor as (
    -- One row per visitor: how deep into the sequence they got. Filtered to
    -- the step names so the partial index on custom events carries the scan.
    select pulse_funnel_depth(array_agg(e.name order by e.ts, e.id), p_steps) as depth
    from events e
    where e.project_id = any(p_project_ids)
      and e.ts >= p_from
      and e.ts <= p_to
      and not e.is_pageview
      and e.name = any(p_steps)
      and e.visitor_hash is not null
    group by e.visitor_hash
  )
  select 0 as step, count(distinct e.visitor_hash)::bigint
  from events e
  where e.project_id = any(p_project_ids)
    and e.ts >= p_from
    and e.ts <= p_to
    and e.visitor_hash is not null
  union all
  select s.step, (select count(*) from per_visitor pv where pv.depth >= s.step)::bigint
  from generate_subscripts(p_steps, 1) as s(step)
  order by step;
end;
$$;

grant execute on function pulse_owner_funnel(uuid[], text[], timestamptz, timestamptz) to authenticated;
revoke all on function pulse_owner_funnel(uuid[], text[], timestamptz, timestamptz) from anon;
revoke all on function pulse_funnel_depth(text[], text[]) from anon;

-- ---------------------------------------------------------------------------
-- 2. Billing intervals on subscription payments
-- ---------------------------------------------------------------------------

-- Null means "interval unknown" — legacy rows, manual entries — and is treated
-- as monthly, which reproduces the old trailing-30-day behavior exactly for
-- the rows that predate this migration.
alter table revenue_records
  add column recurring_interval text
    constraint revenue_recurring_interval_valid
    check (recurring_interval in ('day', 'week', 'month', 'year')),
  add column recurring_interval_count int
    constraint revenue_recurring_interval_count_range
    check (recurring_interval_count between 1 and 36);

-- ---------------------------------------------------------------------------
-- 3. Normalized MRR
-- ---------------------------------------------------------------------------

/**
 * MRR as the monthly run rate of currently-paid-for subscriptions.
 *
 * Each subscription payment covers [occurred_at, occurred_at + interval). A
 * payment whose coverage includes now() contributes amount / months-covered:
 * a $120 annual plan adds $10 every month for a year instead of $120 in its
 * billing month and $0 in the other eleven; a monthly plan contributes its
 * full amount for one month, same as before.
 *
 * Still computed from payments, not subscription objects — a canceled plan
 * drops out when its paid period ends, not the instant it cancels. That is
 * the remaining approximation, and it errs on the side of money actually
 * received.
 */
create or replace function pulse_owner_mrr(p_project_ids uuid[])
returns bigint
language sql
stable
as $$
  select coalesce(sum(
    round(r.amount_base_cents /
      case coalesce(r.recurring_interval, 'month')
        when 'year'  then 12.0 * coalesce(r.recurring_interval_count, 1)
        when 'month' then coalesce(r.recurring_interval_count, 1)::numeric
        when 'week'  then coalesce(r.recurring_interval_count, 1) * 7 / 30.4375
        else              coalesce(r.recurring_interval_count, 1) / 30.4375
      end
    )
  ), 0)::bigint
  from revenue_records r
  where r.project_id = any(p_project_ids)
    and r.kind = 'subscription'
    -- Coverage period contains now: the payment is still paying for service.
    and r.occurred_at + (
      case coalesce(r.recurring_interval, 'month')
        when 'year'  then make_interval(years  => coalesce(r.recurring_interval_count, 1))
        when 'month' then make_interval(months => coalesce(r.recurring_interval_count, 1))
        when 'week'  then make_interval(weeks  => coalesce(r.recurring_interval_count, 1))
        else              make_interval(days   => coalesce(r.recurring_interval_count, 1))
      end
    ) > now();
$$;

-- The goals checker must agree with the number on the dashboard, so its 'mrr'
-- branch calls the same function instead of restating the definition. It runs
-- as the function owner (security definer), so RLS does not hide other rows;
-- the project-id array passed per goal is what scopes it.
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
          select pulse_owner_mrr(
            case when g.project_id is not null
              then array[g.project_id]
              else coalesce(
                (select array_agg(id) from projects where owner_id = g.owner_id),
                '{}'::uuid[])
            end
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
