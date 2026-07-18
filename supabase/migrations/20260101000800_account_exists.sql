-- ---------------------------------------------------------------------------
-- Pulse — "does an account exist yet?"
--
-- The login page offers the one-time owner sign-up only when the instance is
-- brand new. The right signal for that is whether *any account* exists, not
-- whether the `owners` row has been claimed: an account can sit in auth.users
-- before its owners row is created (a signup made while Supabase still required
-- email confirmation, for instance). In that state the previous owner-only
-- check kept showing "Set up Pulse" even though the account exists — and a
-- second signup would only ever error "already registered".
--
-- So key the decision on auth.users instead, and drop the narrower owner check.
-- Whether an account exists is not a secret (the login page already announces
-- this is a Pulse instance); the database trigger, not this bit, is still what
-- refuses a second owner.
-- ---------------------------------------------------------------------------

drop function if exists pulse_owner_exists();

create function pulse_account_exists()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from auth.users);
$$;

revoke all on function pulse_account_exists() from public;
grant execute on function pulse_account_exists() to anon, authenticated;
