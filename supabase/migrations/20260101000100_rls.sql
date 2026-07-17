-- ---------------------------------------------------------------------------
-- Pulse — Row Level Security
--
-- The access model has exactly three principals:
--
--   service_role  the ingest collector and webhooks. Bypasses RLS entirely.
--                 Server-side only, never shipped to a browser.
--   authenticated the owner, reading their own data and nothing else.
--   anon          the public stats page. Has NO direct table access at all —
--                 not even to rollups. It can only call the security-definer
--                 functions in the next migration, which apply the per-project
--                 visibility toggles before returning a single byte.
--
-- Every table below is force-enabled so that even a table owner is subject to
-- policy, and no table grants anything to anon.
-- ---------------------------------------------------------------------------

alter table owners                  enable row level security;
alter table projects                enable row level security;
alter table project_public_settings enable row level security;
alter table events                  enable row level security;
alter table visitor_salts           enable row level security;
alter table revenue_records         enable row level security;
alter table revenue_mappings        enable row level security;
alter table rollups                 enable row level security;
alter table rollup_dimensions       enable row level security;
alter table goals                   enable row level security;
alter table alerts                  enable row level security;
alter table integrations            enable row level security;

-- Deny-by-default: revoke the blanket grants Supabase hands to the API roles,
-- then grant back only what policies should be allowed to evaluate.
revoke all on all tables in schema public from anon, authenticated;

grant select on projects, project_public_settings, events, revenue_records,
                rollups, rollup_dimensions, goals, alerts, integrations,
                revenue_mappings, owners
  to authenticated;
grant insert, update, delete on projects, project_public_settings,
                revenue_records, revenue_mappings, goals, alerts, integrations
  to authenticated;
grant update on owners to authenticated;
grant insert on owners to authenticated;

-- anon gets nothing. Public reads go exclusively through the RPCs.

-- ---------------------------------------------------------------------------
-- Helper: does the current user own this project?
--
-- STABLE + security definer so it can be used inside policies without
-- recursing through `projects`' own RLS.
-- ---------------------------------------------------------------------------

create function owns_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from projects
    where id = p_project_id and owner_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- owners
-- ---------------------------------------------------------------------------

create policy owners_select_self on owners
  for select to authenticated using (id = auth.uid());

create policy owners_update_self on owners
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Claiming ownership is gated by a trigger (see 20260101000300_owner_claim.sql)
-- which enforces PULSE_OWNER_EMAILS / first-user-wins. The policy only ensures
-- you cannot create a row for somebody else.
create policy owners_insert_self on owners
  for insert to authenticated with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create policy projects_all_own on projects
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy pps_all_own on project_public_settings
  for all to authenticated
  using (owns_project(project_id))
  with check (owns_project(project_id));

-- ---------------------------------------------------------------------------
-- events — read-only to the owner (realtime widgets + CSV export).
-- Nobody writes through the API role; only the collector's service_role does.
-- ---------------------------------------------------------------------------

create policy events_select_own on events
  for select to authenticated using (owns_project(project_id));

-- ---------------------------------------------------------------------------
-- visitor_salts — no policies at all.
--
-- With RLS enabled and zero policies, every non-service role is denied. Only
-- current_visitor_salt() (security definer) can reach it. This is deliberate:
-- the salt is the one value that could unwind the anonymization, so it is
-- readable by nothing.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- revenue
-- ---------------------------------------------------------------------------

create policy revenue_all_own on revenue_records
  for all to authenticated
  using (owns_project(project_id))
  with check (owns_project(project_id));

create policy revenue_mappings_all_own on revenue_mappings
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- rollups — owner reads. Written by the rollup functions (security definer).
-- ---------------------------------------------------------------------------

create policy rollups_select_own on rollups
  for select to authenticated using (owns_project(project_id));

create policy rollup_dimensions_select_own on rollup_dimensions
  for select to authenticated using (owns_project(project_id));

-- ---------------------------------------------------------------------------
-- goals / alerts / integrations
-- ---------------------------------------------------------------------------

create policy goals_all_own on goals
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy alerts_all_own on alerts
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy integrations_all_own on integrations
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
