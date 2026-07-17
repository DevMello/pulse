-- ---------------------------------------------------------------------------
-- Pulse — owner claiming
--
-- Pulse is a single-owner instance. Supabase Auth will happily let anyone who
-- finds the login page sign up, so "who is allowed to be the owner" has to be
-- enforced somewhere. Doing it in the app would mean a forgotten check in one
-- route hands a stranger the dashboard, so it is enforced here instead.
--
-- Two modes:
--   * allow-list  — set pulse.owner_emails; only those addresses may claim.
--   * first-wins  — no allow-list; the first account to sign in becomes the
--                   owner and every later signup is refused.
--
-- Set the allow-list on the database with:
--   alter database postgres set pulse.owner_emails = 'you@example.com';
-- ---------------------------------------------------------------------------

create function pulse_owner_allowed(p_email text)
returns boolean
language plpgsql
stable
as $$
declare
  v_list text;
begin
  -- current_setting(..., true) returns null instead of raising when the GUC
  -- was never set, which is the normal first-wins case.
  v_list := current_setting('pulse.owner_emails', true);

  if v_list is null or btrim(v_list) = '' then
    -- First-wins: allowed only while no owner exists yet.
    return not exists (select 1 from owners);
  end if;

  return lower(btrim(p_email)) in (
    select lower(btrim(x)) from unnest(string_to_array(v_list, ',')) as x
  );
end;
$$;

create function pulse_enforce_owner_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select email into v_email from auth.users where id = new.id;

  if v_email is null then
    raise exception 'pulse: no auth user for %', new.id
      using errcode = 'check_violation';
  end if;

  if not pulse_owner_allowed(v_email) then
    raise exception 'pulse: % is not permitted to claim this instance', v_email
      using errcode = 'insufficient_privilege',
            hint = 'Add the address to pulse.owner_emails, or this instance already has an owner.';
  end if;

  new.email := v_email;
  return new;
end;
$$;

create trigger enforce_owner_claim
  before insert on owners
  for each row execute function pulse_enforce_owner_claim();

-- ---------------------------------------------------------------------------
-- Convenience: create the public-settings row alongside every project, so the
-- dashboard and the public RPCs never have to cope with a missing row.
-- ---------------------------------------------------------------------------

create function pulse_project_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into project_public_settings (project_id)
  values (new.id)
  on conflict (project_id) do nothing;
  return new;
end;
$$;

create trigger project_defaults
  after insert on projects
  for each row execute function pulse_project_defaults();
