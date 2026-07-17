-- ---------------------------------------------------------------------------
-- Pulse — "is this instance claimed yet?"
--
-- The login page needs to know whether an owner already exists, so it can hide
-- the one-time "create the owner account" path once the instance is claimed.
-- But that page is unauthenticated, and `anon` has no grant on `owners` (see
-- 20260101000100_rls.sql) — reading the table directly returns nothing, which
-- would make a claimed instance look unclaimed.
--
-- So expose exactly one bit through a security-definer function, the same way
-- every other public read is exposed (20260101000300_public_api.sql): a single
-- boolean, no rows, no owner identity. Whether an instance is claimed is not a
-- secret — the login page already announces it is a Pulse instance — and the
-- database trigger, not this bit, is what actually refuses a second owner.
-- ---------------------------------------------------------------------------

create function pulse_owner_exists()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from owners);
$$;

revoke all on function pulse_owner_exists() from public;
grant execute on function pulse_owner_exists() to anon, authenticated;
