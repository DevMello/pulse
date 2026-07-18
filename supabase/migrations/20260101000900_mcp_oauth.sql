-- ---------------------------------------------------------------------------
-- Pulse — MCP server & OAuth 2.1 authorization server
--
-- Lets an AI agent (Claude, ChatGPT, Cursor, …) create projects and read back
-- ingest keys on the owner's behalf, over the Model Context Protocol.
--
-- MCP's auth story is OAuth 2.1 with PKCE and dynamic client registration: the
-- agent has no pre-shared credential, so it registers itself, sends the owner
-- through a browser consent screen, and leaves with a token. Four tables model
-- that exactly:
--
--   mcp_clients          who registered (RFC 7591). Not trusted, not verified.
--   mcp_authorizations   the owner's standing "yes" to one client. Revocable,
--                        and what the Connected apps UI lists.
--   mcp_auth_codes       single-use, 60-second bridge between the consent
--                        screen and the token endpoint.
--   mcp_tokens           access + refresh tokens hanging off an authorization.
--
-- Nothing here stores a credential in the clear. Codes and tokens live only as
-- SHA-256 hashes, so a database leak yields no usable token — the same reason
-- password hashes exist. The plaintext is returned to the client exactly once,
-- at the moment it is minted, and is unrecoverable afterwards.
--
-- Every table is service_role-only. The OAuth endpoints run server-side with
-- the service key; no browser and no `authenticated` session ever reads a
-- token row. The single exception is the owner's read of their own
-- authorizations, which powers the revoke UI and exposes no secret.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Clients
--
-- Dynamic registration is open by design: it is how MCP clients bootstrap, and
-- the spec expects an unauthenticated POST here. That is safe because a client
-- row grants nothing. It is an inert record until an owner completes the
-- consent screen, and the owner sees the client's self-declared name at that
-- moment. Treat every column as attacker-controlled string data.
-- ---------------------------------------------------------------------------

create table mcp_clients (
  -- Opaque random id we issue, never one the client picks.
  client_id     text primary key,

  -- Public clients (PKCE, no secret) are the norm for MCP: a desktop app or a
  -- CLI cannot keep a secret. Confidential clients get a hash here, matching
  -- how tokens are stored — never the secret itself.
  client_secret_hash text,

  -- Self-declared, shown on the consent screen. Rendered as text, never HTML.
  client_name   text not null default 'Unnamed client',
  client_uri    text,
  logo_uri      text,

  -- Exact-match allow-list. A redirect_uri that is not byte-identical to one of
  -- these is refused; this is the check that stops an authorization code being
  -- delivered to an attacker's endpoint.
  redirect_uris text[] not null,

  grant_types   text[] not null default '{authorization_code,refresh_token}',
  scope         text not null default 'projects:read projects:write',

  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,

  constraint mcp_clients_have_redirects check (cardinality(redirect_uris) > 0)
);

-- ---------------------------------------------------------------------------
-- Authorizations — the owner's grant to one client
--
-- One row per (owner, client). Re-running consent updates the existing row
-- rather than accumulating duplicates, so "Connected apps" shows one entry per
-- app no matter how many times it reconnected.
-- ---------------------------------------------------------------------------

create table mcp_authorizations (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references owners (id) on delete cascade,
  client_id  text not null references mcp_clients (client_id) on delete cascade,

  scope      text not null default 'projects:read projects:write',

  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  -- Set instead of deleting: revoking must invalidate live tokens without
  -- erasing the record that access was once granted.
  revoked_at    timestamptz
);

create unique index mcp_authorizations_owner_client_key
  on mcp_authorizations (owner_id, client_id);
create index mcp_authorizations_owner_idx
  on mcp_authorizations (owner_id) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Authorization codes
--
-- Short-lived and strictly single-use. `consumed_at` is what makes replay
-- impossible: the token endpoint claims the code with a conditional UPDATE, so
-- two concurrent redemptions cannot both win.
-- ---------------------------------------------------------------------------

create table mcp_auth_codes (
  code_hash        text primary key,
  authorization_id uuid not null references mcp_authorizations (id) on delete cascade,
  client_id        text not null references mcp_clients (client_id) on delete cascade,

  -- Pinned at issue time and re-checked at redemption. Both are mandatory in
  -- OAuth 2.1 — the redirect_uri because it was part of what the owner
  -- approved, the challenge because PKCE is what binds the code to the client
  -- instance that started the flow.
  redirect_uri     text not null,
  code_challenge   text not null,
  code_challenge_method text not null default 'S256',

  scope            text not null,
  -- RFC 8707 resource indicator. Recorded so a token minted for this Pulse
  -- instance cannot be replayed against a different MCP server.
  resource         text,

  expires_at       timestamptz not null,
  consumed_at      timestamptz,
  created_at       timestamptz not null default now(),

  -- S256 only. OAuth 2.1 removes `plain`, and accepting it would let a network
  -- observer who sees the code also mint the verifier.
  constraint mcp_auth_codes_pkce_s256 check (code_challenge_method = 'S256')
);

create index mcp_auth_codes_expiry_idx on mcp_auth_codes (expires_at);

-- ---------------------------------------------------------------------------
-- Tokens
--
-- Access and refresh tokens share a table because they share a lifecycle: both
-- hang off an authorization, both die when it is revoked, both are stored only
-- as hashes.
-- ---------------------------------------------------------------------------

create table mcp_tokens (
  token_hash       text primary key,
  authorization_id uuid not null references mcp_authorizations (id) on delete cascade,
  kind             text not null,

  scope            text not null,
  resource         text,

  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now(),
  last_used_at     timestamptz,

  constraint mcp_tokens_kind_valid check (kind in ('access', 'refresh'))
);

create index mcp_tokens_authorization_idx on mcp_tokens (authorization_id);
create index mcp_tokens_expiry_idx on mcp_tokens (expires_at) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- RLS
--
-- Same posture as the rest of the schema: force-enabled, blanket grants
-- revoked, and only the narrowest thing granted back. The OAuth endpoints all
-- run as service_role, which bypasses RLS, so these tables need no policies to
-- function — only to stay unreachable from a browser.
-- ---------------------------------------------------------------------------

alter table mcp_clients        enable row level security;
alter table mcp_authorizations enable row level security;
alter table mcp_auth_codes     enable row level security;
alter table mcp_tokens         enable row level security;

alter table mcp_clients        force row level security;
alter table mcp_authorizations force row level security;
alter table mcp_auth_codes     force row level security;
alter table mcp_tokens         force row level security;

revoke all on mcp_clients, mcp_authorizations, mcp_auth_codes, mcp_tokens
  from anon, authenticated;

-- The owner may list and revoke their own grants. Deliberately no access to
-- mcp_auth_codes or mcp_tokens: those hold hashes, and there is no feature that
-- needs a browser to read them. The client name shown in the UI is joined
-- server-side.
grant select, update on mcp_authorizations to authenticated;
grant select on mcp_clients to authenticated;

create policy mcp_authorizations_select_own on mcp_authorizations
  for select to authenticated using (owner_id = auth.uid());

-- Update, not delete, and scoped so the only reachable change is revocation of
-- a row you already own.
create policy mcp_authorizations_revoke_own on mcp_authorizations
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- A client row is readable only while it has a live grant from the reader.
-- Without this the table would be a public directory of every app that ever
-- registered.
create policy mcp_clients_select_granted on mcp_clients
  for select to authenticated using (
    exists (
      select 1 from mcp_authorizations a
      where a.client_id = mcp_clients.client_id
        and a.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Garbage collection
--
-- Expired codes and tokens are dead weight, and a table of stale hashes is a
-- liability with no upside. Clients registered long ago that never got a grant
-- are abandoned bootstrap attempts, so they go too.
-- ---------------------------------------------------------------------------

create function pulse_mcp_gc()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from mcp_auth_codes where expires_at < now() - interval '1 hour';

  -- Refresh tokens are long-lived, so the grace period is generous: a token
  -- deleted the instant it expires turns a clock-skewed refresh into a
  -- confusing "invalid_grant" instead of a clean "expired".
  delete from mcp_tokens
  where (expires_at < now() - interval '30 days')
     or (revoked_at is not null and revoked_at < now() - interval '30 days');

  delete from mcp_clients c
  where c.created_at < now() - interval '1 day'
    and not exists (select 1 from mcp_authorizations a where a.client_id = c.client_id);
end;
$$;

select cron.schedule(
  'pulse-mcp-gc',
  '43 4 * * *',
  $$ select pulse_mcp_gc(); $$
);
