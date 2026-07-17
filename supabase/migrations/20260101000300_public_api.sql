-- ---------------------------------------------------------------------------
-- Pulse — the public read path
--
-- The public stats page runs as `anon`, which has no table grants whatsoever.
-- These functions are the entire public surface area. Each one:
--
--   1. resolves only projects with is_public = true,
--   2. drops any metric the owner toggled off BEFORE returning it,
--   3. returns aggregates only — never a row from `events`,
--   4. applies the owner's number_style so "rounded"/"bucketed"/"relative"
--      are enforced in the database, not in client code that could be
--      bypassed by calling the API directly.
--
-- Point 4 matters: if masking happened in React, anyone could read the exact
-- numbers out of the network tab. Hidden means never serialized.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Number masking
-- ---------------------------------------------------------------------------

create function pulse_bucket_number(n bigint)
returns text
language sql immutable
as $$
  select case
    when n is null then null
    when n < 100     then '<100'
    when n < 500     then '100–500'
    when n < 1000    then '500–1k'
    when n < 5000    then '1k–5k'
    when n < 10000   then '5k–10k'
    when n < 25000   then '10k–25k'
    when n < 50000   then '25k–50k'
    when n < 100000  then '50k–100k'
    when n < 500000  then '100k–500k'
    when n < 1000000 then '500k–1M'
    else '1M+'
  end;
$$;

-- Applies the project's number_style to a raw figure, returning both a numeric
-- value (null when the style forbids exact figures) and a display string.
create function pulse_mask_number(n bigint, style text)
returns jsonb
language sql immutable
as $$
  select case style
    when 'exact' then
      jsonb_build_object('value', n, 'display', n::text)
    when 'rounded' then
      jsonb_build_object(
        'value', case
          when n < 1000 then (round(n / 10.0) * 10)::bigint
          when n < 100000 then (round(n / 100.0) * 100)::bigint
          else (round(n / 1000.0) * 1000)::bigint
        end,
        'display', null)
    when 'bucketed' then
      jsonb_build_object('value', null, 'display', pulse_bucket_number(n))
    when 'relative' then
      jsonb_build_object('value', null, 'display', null)
    else
      jsonb_build_object('value', n, 'display', n::text)
  end;
$$;

-- Percentage change, guarding the 0 → n case that would divide by zero.
create function pulse_pct_change(prev bigint, cur bigint)
returns numeric
language sql immutable
as $$
  select case
    when prev = 0 and cur = 0 then 0
    when prev = 0 then null            -- "new", not "+∞%"
    else round(((cur - prev)::numeric / prev) * 100, 1)
  end;
$$;

-- ---------------------------------------------------------------------------
-- pulse_public_overview(range_days)
--
-- The main payload for /stats. One round trip returns the whole page.
-- ---------------------------------------------------------------------------
create function pulse_public_overview(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from   timestamptz;
  v_prev   timestamptz;
  v_result jsonb;
begin
  -- Clamp: an unbounded range would let anyone force an expensive scan.
  p_days := least(greatest(coalesce(p_days, 30), 1), 730);
  v_from := date_trunc('day', now()) - make_interval(days => p_days - 1);
  v_prev := v_from - make_interval(days => p_days);

  with pub as (
    select p.id, p.name, p.slug, s.is_public, s.show_visitors, s.show_pageviews,
           s.show_revenue, s.number_style
    from projects p
    join project_public_settings s on s.project_id = p.id
    where s.is_public and not p.archived
  ),
  -- Current period totals per project.
  cur as (
    select r.project_id,
      sum(r.pageviews)::bigint     as pageviews,
      sum(r.visitors)::bigint      as visitors,
      sum(r.revenue_cents)::bigint as revenue_cents
    from rollups r
    join pub on pub.id = r.project_id
    where r.period = 'day' and r.bucket >= v_from
    group by r.project_id
  ),
  -- Previous period, for the trend arrows and for 'relative' number style.
  prev as (
    select r.project_id,
      sum(r.pageviews)::bigint     as pageviews,
      sum(r.visitors)::bigint      as visitors,
      sum(r.revenue_cents)::bigint as revenue_cents
    from rollups r
    join pub on pub.id = r.project_id
    where r.period = 'day' and r.bucket >= v_prev and r.bucket < v_from
    group by r.project_id
  ),
  -- Daily series for sparklines, already masked per project.
  series as (
    select r.project_id,
      jsonb_agg(jsonb_build_object(
        'date', to_char(r.bucket at time zone 'UTC', 'YYYY-MM-DD'),
        'pageviews', case when pub.show_pageviews then r.pageviews end,
        'visitors',  case when pub.show_visitors  then r.visitors  end,
        'revenue',   case when pub.show_revenue   then r.revenue_cents end
      ) order by r.bucket) as points
    from rollups r
    join pub on pub.id = r.project_id
    where r.period = 'day' and r.bucket >= v_from
    group by r.project_id
  ),
  projects_json as (
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'slug', pub.slug,
      'name', pub.name,
      'number_style', pub.number_style,
      'visitors',  case when pub.show_visitors
                        then pulse_mask_number(coalesce(cur.visitors, 0), pub.number_style) end,
      'pageviews', case when pub.show_pageviews
                        then pulse_mask_number(coalesce(cur.pageviews, 0), pub.number_style) end,
      -- Revenue is never masked into a bucket string: it is either shown as a
      -- real figure or withheld entirely. A money range invites bad guesses.
      'revenue_cents', case when pub.show_revenue then coalesce(cur.revenue_cents, 0) end,
      'trend', jsonb_build_object(
        'visitors',  pulse_pct_change(coalesce(prev.visitors, 0),  coalesce(cur.visitors, 0)),
        'pageviews', pulse_pct_change(coalesce(prev.pageviews, 0), coalesce(cur.pageviews, 0)),
        'revenue',   case when pub.show_revenue
                          then pulse_pct_change(coalesce(prev.revenue_cents, 0), coalesce(cur.revenue_cents, 0)) end
      ),
      'series', coalesce(series.points, '[]'::jsonb)
    ) ) order by coalesce(cur.visitors, 0) desc) as v
    from pub
    left join cur    on cur.project_id = pub.id
    left join prev   on prev.project_id = pub.id
    left join series on series.project_id = pub.id
  ),
  -- Combined totals only include projects whose owner published that metric,
  -- so a hidden project cannot be inferred by subtracting from the total.
  totals as (
    select
      sum(case when pub.show_visitors  then coalesce(cur.visitors, 0)  else 0 end)::bigint as visitors,
      sum(case when pub.show_pageviews then coalesce(cur.pageviews, 0) else 0 end)::bigint as pageviews,
      sum(case when pub.show_revenue   then coalesce(cur.revenue_cents, 0) else 0 end)::bigint as revenue_cents,
      bool_or(pub.show_revenue) as any_revenue
    from pub left join cur on cur.project_id = pub.id
  ),
  owner_meta as (
    select public_title, public_bio, public_theme
    from owners
    -- Single-tenant: there is one owner. A multi-tenant fork would resolve by
    -- host here instead.
    order by created_at limit 1
  ),
  milestones as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'label', coalesce(g.label, g.metric),
      'metric', g.metric,
      'target', g.target,
      'achieved_at', g.achieved_at
    ) order by g.achieved_at desc nulls last), '[]'::jsonb) as v
    from goals g
    where g.show_public
      and (g.project_id is null or exists (select 1 from pub where pub.id = g.project_id))
  )
  select jsonb_build_object(
    'range_days', p_days,
    'generated_at', now(),
    'title', (select public_title from owner_meta),
    'bio',   (select public_bio   from owner_meta),
    'theme', coalesce((select public_theme from owner_meta), '{}'::jsonb),
    'totals', jsonb_build_object(
      'visitors',  (select visitors  from totals),
      'pageviews', (select pageviews from totals),
      'revenue_cents', (select case when any_revenue then revenue_cents end from totals)
    ),
    'projects', coalesce((select v from projects_json), '[]'::jsonb),
    'milestones', (select v from milestones)
  )
  into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- pulse_public_breakdown(slug, dimension, days, limit)
--
-- Top pages / sources / countries for one published project.
-- ---------------------------------------------------------------------------
create function pulse_public_breakdown(
  p_slug text,
  p_dimension text,
  p_days int default 30,
  p_limit int default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_project uuid;
  v_style   text;
  v_allowed boolean;
  v_from    timestamptz;
  v_result  jsonb;
begin
  p_days  := least(greatest(coalesce(p_days, 30), 1), 730);
  p_limit := least(greatest(coalesce(p_limit, 10), 1), 100);
  v_from  := date_trunc('day', now()) - make_interval(days => p_days - 1);

  -- Resolve the project and, in the same step, decide whether this specific
  -- dimension is published. An unknown slug and an unpublished one return the
  -- same empty result, so the endpoint cannot be used to enumerate projects.
  select p.id, s.number_style,
    case p_dimension
      when 'path'      then s.show_top_pages
      when 'referrer'  then s.show_sources
      when 'country'   then s.show_countries
      else false
    end
  into v_project, v_style, v_allowed
  from projects p
  join project_public_settings s on s.project_id = p.id
  where p.slug = p_slug and s.is_public and not p.archived;

  if v_project is null or not coalesce(v_allowed, false) then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(x order by x_hits desc), '[]'::jsonb)
  into v_result
  from (
    select
      jsonb_build_object(
        'value', d.value,
        'hits',  pulse_mask_number(sum(d.hits)::bigint, v_style),
        'visitors', pulse_mask_number(sum(d.visitors)::bigint, v_style)
      ) as x,
      sum(d.hits) as x_hits
    from rollup_dimensions d
    where d.project_id = v_project
      and d.dimension = p_dimension
      and d.period = 'day'
      and d.bucket >= v_from
    group by d.value
    order by sum(d.hits) desc
    limit p_limit
  ) t;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- pulse_public_live(slug)
--
-- "Currently online". Reads recent raw events, which is the one public query
-- that touches the firehose — bounded to a 5 minute window on an index, and
-- returning a single integer.
-- ---------------------------------------------------------------------------
create function pulse_public_live(p_slug text default null)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  select count(distinct e.visitor_hash)
  into v_count
  from events e
  join projects p on p.id = e.project_id
  join project_public_settings s on s.project_id = p.id
  where s.is_public and s.show_live and not p.archived
    and (p_slug is null or p.slug = p_slug)
    -- Bounded on both sides. The upper bound looks redundant because the
    -- collector stamps ts server-side, but without it a single future-dated
    -- row (clock skew, a backfill, an import) pins "currently online" to a
    -- wrong number forever, and it is the one stat people stare at.
    and e.ts >  now() - interval '5 minutes'
    and e.ts <= now();

  return coalesce(v_count, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
--
-- These four functions, and nothing else, are what `anon` may call.
-- ---------------------------------------------------------------------------
revoke all on function pulse_public_overview(int)                  from public;
revoke all on function pulse_public_breakdown(text, text, int, int) from public;
revoke all on function pulse_public_live(text)                     from public;

grant execute on function pulse_public_overview(int)                   to anon, authenticated;
grant execute on function pulse_public_breakdown(text, text, int, int)  to anon, authenticated;
grant execute on function pulse_public_live(text)                      to anon, authenticated;

-- Maintenance functions are off-limits to both API roles...
revoke all on function pulse_rollup(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function pulse_backfill(int)     from public, anon, authenticated;
revoke all on function pulse_prune()           from public, anon, authenticated;
revoke all on function pulse_rollup_recent()   from public, anon, authenticated;

-- ...except pulse_rollup_recent, which the owner may trigger.
--
-- Without this, a manually-entered sale is invisible until cron runs, which
-- reads as "the form silently didn't work" and invites double entry — a worse
-- outcome than the cost of the call. It stays revoked from anon: it is the one
-- genuinely expensive function here, and anon has no reason to ever roll up.
grant execute on function pulse_rollup_recent() to authenticated;

-- The salt is readable by nothing. This is the value that could unwind the
-- anonymization, so not even the owner's session may fetch it.
revoke all on function current_visitor_salt()  from public, anon, authenticated;
