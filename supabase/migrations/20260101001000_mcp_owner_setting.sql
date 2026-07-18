-- ---------------------------------------------------------------------------
-- Pulse — MCP is an owner setting, not a deploy setting
--
-- The MCP server was originally gated on a PULSE_MCP_ENABLED environment
-- variable. That was the wrong control: turning the feature on or off is a
-- decision about *your account*, made in the moment — usually right after
-- noticing an app you don't recognize — and an env var means editing Vercel and
-- waiting on a redeploy to act on that. Worse, it is invisible from inside the
-- product, so the settings page could only describe a switch it couldn't throw.
--
-- Moving it here makes the kill switch immediate and puts it next to the list of
-- connected apps, which is the screen you are on when you want it.
--
-- Defaults to true: a fresh instance can be connected to an assistant without a
-- detour through configuration. Nothing is exposed by that default on its own —
-- an app still holds no access until the owner approves it by name on the
-- consent screen, and the whole surface still requires SUPABASE_SERVICE_ROLE_KEY
-- to function at all.
-- ---------------------------------------------------------------------------

alter table owners
  add column mcp_enabled boolean not null default true;

comment on column owners.mcp_enabled is
  'Whether this instance answers MCP and OAuth requests. Owner-controlled from '
  '/app/settings; flipping it off immediately 404s discovery and 401s every '
  'live token without revoking any grant.';

-- ---------------------------------------------------------------------------
-- pulse_mcp_enabled()
--
-- Pulse is single-owner by design (see the comment on `owners`), so "is MCP on"
-- has one answer for the whole deployment. The unauthenticated endpoints —
-- discovery, registration, token exchange — need that answer before they know
-- who is asking, and they run as service_role, so this exists to give them one
-- cheap, well-defined lookup rather than each inventing its own.
--
-- Returns false when no owner row exists yet. An unclaimed instance should not
-- be answering OAuth at all: there is nobody to grant access, so the honest
-- response to a client is that there is nothing here.
-- ---------------------------------------------------------------------------

create function pulse_mcp_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select mcp_enabled from owners order by created_at limit 1), false);
$$;

-- Callable without a session: the token endpoint and the discovery documents
-- are reached by clients that have not authenticated and may never.
grant execute on function pulse_mcp_enabled() to anon, authenticated;
