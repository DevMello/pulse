import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * OAuth 2.1 authorization server for the MCP endpoint.
 *
 * Scope note: this is not a general-purpose OAuth provider and should not grow
 * into one. It exists to authorize MCP clients against one Pulse instance, so
 * it implements exactly the profile MCP requires — authorization code grant,
 * mandatory PKCE with S256, dynamic client registration, refresh rotation —
 * and deliberately supports nothing else. No implicit grant, no password grant,
 * no `plain` challenge method: OAuth 2.1 removes all three, and every one of
 * them is a known way to leak a token.
 *
 * The storage rule throughout: a credential is returned to its owner once, at
 * mint time, and everything persisted is a SHA-256 hash. Lookups hash the
 * presented value and query by primary key, so the database never holds
 * anything an attacker could steal and replay.
 */

// ---------------------------------------------------------------------------
// Lifetimes
// ---------------------------------------------------------------------------

/**
 * Authorization codes are a bridge between two HTTP requests that happen
 * back-to-back, so the window is tight. The spec says "maximum of 10 minutes";
 * a real client redeems in well under a second.
 */
const CODE_TTL_SECONDS = 60;

/** Short enough that a leaked access token is a small problem, long enough not to churn. */
const ACCESS_TTL_SECONDS = 60 * 60;

/** Refresh tokens rotate on every use, so a long life costs little. */
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;

export const SUPPORTED_SCOPES = ['projects:read', 'projects:write'] as const;
export const DEFAULT_SCOPE = SUPPORTED_SCOPES.join(' ');

export type Scope = (typeof SUPPORTED_SCOPES)[number];

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** 256 bits of CSPRNG output. Long enough that guessing is not a threat model. */
function randomSecret(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

/**
 * How every credential is stored.
 *
 * Plain SHA-256 with no salt or stretching, which would be wrong for passwords
 * and is right here: these are 256-bit random strings, so there is no dictionary
 * to attack and nothing for a work factor to slow down. It also has to stay
 * fast — this runs on every MCP request.
 */
async function hashSecret(value: string): Promise<string> {
  return Buffer.from(await sha256(value)).toString('hex');
}

/**
 * PKCE S256 check: does this verifier produce the challenge we stored?
 *
 * This is what binds an authorization code to the specific client instance that
 * began the flow. Without it, anyone who intercepts the code — from a redirect
 * on a shared machine, a browser history entry, a leaky log — can trade it for
 * a token.
 */
export async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  // RFC 7636 bounds the verifier at 43–128 chars from an unreserved alphabet.
  // Checking it here keeps a malformed value from reaching the digest at all.
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return base64url(await sha256(verifier)) === challenge;
}

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

/**
 * Narrow a requested scope to what we actually support.
 *
 * Silently dropping unknown scopes rather than erroring is what RFC 6749 §3.3
 * allows and what clients expect; the granted scope comes back in the token
 * response, so a client that needed more can see it did not get it.
 */
export function normalizeScope(requested: string | null | undefined): string {
  if (!requested) return DEFAULT_SCOPE;

  const granted = requested
    .split(/\s+/)
    .filter((s): s is Scope => (SUPPORTED_SCOPES as readonly string[]).includes(s));

  return granted.length ? [...new Set(granted)].join(' ') : DEFAULT_SCOPE;
}

export function hasScope(scope: string, required: Scope): boolean {
  return scope.split(/\s+/).includes(required);
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export interface RegisteredClient {
  client_id: string;
  client_name: string;
  client_uri: string | null;
  logo_uri: string | null;
  redirect_uris: string[];
  scope: string;
}

export interface ClientRegistration {
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  redirect_uris: string[];
  scope?: string;
}

/**
 * Which redirect URIs a client may register.
 *
 * The open redirect is the classic OAuth hole, and dynamic registration means
 * anyone can propose a URI. Two shapes are safe and cover every real MCP client:
 *
 *   https://…      remote clients (claude.ai, chatgpt.com) — TLS, no fragment
 *   http://127.0.0.1:… loopback for desktop/CLI clients (RFC 8252 §7.3)
 *
 * `http://localhost` is accepted alongside the literal loopback IP because
 * several clients hard-code it, and it resolves to the same place. Anything
 * else — custom schemes, plaintext http to a real host, a fragment — is
 * refused, because each is a way to hand a code to somewhere it should not go.
 */
export function isAllowedRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  // A fragment is never meaningful on a redirect target and is how an attacker
  // smuggles a second destination past a naive prefix check.
  if (url.hash) return false;

  if (url.protocol === 'https:') return true;

  if (url.protocol === 'http:') {
    return url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === 'localhost';
  }

  return false;
}

export async function registerClient(input: ClientRegistration): Promise<RegisteredClient> {
  const db = supabaseAdmin();

  const redirectUris = input.redirect_uris.filter(isAllowedRedirectUri);
  if (!redirectUris.length) {
    throw new OAuthError('invalid_redirect_uri', 'No usable redirect_uri. Use https, or http on loopback.');
  }

  // `mcp_` prefix so a stray client id is identifiable in a log or a bug report.
  const clientId = `mcp_${randomSecret().slice(0, 24)}`;

  const { data, error } = await db
    .from('mcp_clients')
    .insert({
      client_id: clientId,
      // Truncated because it is attacker-supplied and lands on a consent screen;
      // an unbounded string there is a layout bug waiting to happen.
      client_name: (input.client_name ?? 'Unnamed client').slice(0, 120),
      client_uri: input.client_uri?.slice(0, 500) ?? null,
      logo_uri: input.logo_uri?.slice(0, 500) ?? null,
      redirect_uris: redirectUris,
      scope: normalizeScope(input.scope),
    })
    .select('client_id, client_name, client_uri, logo_uri, redirect_uris, scope')
    .single();

  if (error) throw new OAuthError('server_error', error.message);
  return data as RegisteredClient;
}

export async function getClient(clientId: string): Promise<RegisteredClient | null> {
  const { data } = await supabaseAdmin()
    .from('mcp_clients')
    .select('client_id, client_name, client_uri, logo_uri, redirect_uris, scope')
    .eq('client_id', clientId)
    .maybeSingle();

  return (data as RegisteredClient | null) ?? null;
}

// ---------------------------------------------------------------------------
// Authorization codes
// ---------------------------------------------------------------------------

export interface IssueCodeInput {
  ownerId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string | null;
}

/**
 * Record the owner's consent and mint a code for it.
 *
 * The authorization row is upserted, so reconnecting an app the owner already
 * approved updates that grant instead of stacking up duplicates in the
 * Connected apps list. Re-consenting also clears a previous revocation — the
 * owner just said yes again, on a screen that named the app.
 */
export async function issueAuthorizationCode(input: IssueCodeInput): Promise<string> {
  const db = supabaseAdmin();

  const { data: grant, error: grantError } = await db
    .from('mcp_authorizations')
    .upsert(
      {
        owner_id: input.ownerId,
        client_id: input.clientId,
        scope: input.scope,
        revoked_at: null,
      },
      { onConflict: 'owner_id,client_id' }
    )
    .select('id')
    .single();

  if (grantError) throw new OAuthError('server_error', grantError.message);

  const code = randomSecret();
  const { error } = await db.from('mcp_auth_codes').insert({
    code_hash: await hashSecret(code),
    authorization_id: grant.id,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    scope: input.scope,
    resource: input.resource,
    expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString(),
  });

  if (error) throw new OAuthError('server_error', error.message);
  return code;
}

export interface RedeemCodeInput {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}

/**
 * Trade a code for tokens.
 *
 * Every check here is load-bearing, so none of them collapse into the lookup:
 * the code must exist, be unexpired, belong to this client, have been issued
 * for this exact redirect_uri, and match the PKCE challenge. Failing any of
 * them returns the same opaque `invalid_grant`, because telling a caller which
 * check failed tells an attacker which half of a guess was right.
 */
export async function redeemAuthorizationCode(input: RedeemCodeInput): Promise<TokenSet> {
  const db = supabaseAdmin();
  const codeHash = await hashSecret(input.code);

  const { data: row } = await db
    .from('mcp_auth_codes')
    .select('code_hash, authorization_id, client_id, redirect_uri, code_challenge, scope, resource, expires_at, consumed_at')
    .eq('code_hash', codeHash)
    .maybeSingle();

  if (!row) throw new OAuthError('invalid_grant', 'Authorization code is not valid.');

  /**
   * A code presented twice means one of two things: a client retried, or a code
   * leaked and someone is racing the legitimate holder. We cannot tell which,
   * so we assume the worse one and kill every token from this grant. That
   * logs the app out and forces a fresh consent — noisy, but the alternative is
   * leaving an attacker holding a live token.
   */
  if (row.consumed_at) {
    await revokeAuthorization(row.authorization_id);
    throw new OAuthError('invalid_grant', 'Authorization code has already been used.');
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new OAuthError('invalid_grant', 'Authorization code has expired.');
  }

  if (row.client_id !== input.clientId || row.redirect_uri !== input.redirectUri) {
    throw new OAuthError('invalid_grant', 'Authorization code does not match this request.');
  }

  if (!(await verifyPkce(input.codeVerifier, row.code_challenge))) {
    throw new OAuthError('invalid_grant', 'PKCE verification failed.');
  }

  /**
   * Claim the code with a conditional update rather than a plain one. Two
   * requests can pass the `consumed_at` check above simultaneously; only the
   * one whose UPDATE matches `is null` gets a row back, and the loser is
   * treated as the replay it might be.
   */
  const { data: claimed } = await db
    .from('mcp_auth_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('code_hash', codeHash)
    .is('consumed_at', null)
    .select('code_hash');

  if (!claimed?.length) {
    await revokeAuthorization(row.authorization_id);
    throw new OAuthError('invalid_grant', 'Authorization code has already been used.');
  }

  return mintTokens({
    authorizationId: row.authorization_id,
    scope: row.scope,
    resource: row.resource,
  });
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

async function mintTokens(args: {
  authorizationId: string;
  scope: string;
  resource: string | null;
}): Promise<TokenSet> {
  const db = supabaseAdmin();
  const now = Date.now();

  const accessToken = randomSecret();
  const refreshToken = randomSecret();

  const { error } = await db.from('mcp_tokens').insert([
    {
      token_hash: await hashSecret(accessToken),
      authorization_id: args.authorizationId,
      kind: 'access',
      scope: args.scope,
      resource: args.resource,
      expires_at: new Date(now + ACCESS_TTL_SECONDS * 1000).toISOString(),
    },
    {
      token_hash: await hashSecret(refreshToken),
      authorization_id: args.authorizationId,
      kind: 'refresh',
      scope: args.scope,
      resource: args.resource,
      expires_at: new Date(now + REFRESH_TTL_SECONDS * 1000).toISOString(),
    },
  ]);

  if (error) throw new OAuthError('server_error', error.message);

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TTL_SECONDS,
    scope: args.scope,
  };
}

/**
 * Exchange a refresh token for a new pair, invalidating the old one.
 *
 * Rotation is mandatory in OAuth 2.1 for public clients, and it is what makes
 * refresh-token theft detectable: the real client and the attacker cannot both
 * use the same token, so the second use surfaces the breach. When it does, the
 * whole authorization dies — see the reuse branch below.
 */
export async function refreshTokens(refreshToken: string, clientId: string): Promise<TokenSet> {
  const db = supabaseAdmin();
  const tokenHash = await hashSecret(refreshToken);

  const { data: row } = await db
    .from('mcp_tokens')
    .select('token_hash, authorization_id, kind, scope, resource, expires_at, revoked_at, mcp_authorizations!inner(client_id, revoked_at)')
    .eq('token_hash', tokenHash)
    .eq('kind', 'refresh')
    .maybeSingle();

  if (!row) throw new OAuthError('invalid_grant', 'Refresh token is not valid.');

  const grant = row.mcp_authorizations as unknown as { client_id: string; revoked_at: string | null };

  // A revoked token being presented is the signature of a stolen one: the
  // legitimate client already rotated past it. Burn the grant.
  if (row.revoked_at) {
    await revokeAuthorization(row.authorization_id);
    throw new OAuthError('invalid_grant', 'Refresh token has already been used.');
  }

  if (grant.revoked_at) throw new OAuthError('invalid_grant', 'This authorization was revoked.');
  if (grant.client_id !== clientId) throw new OAuthError('invalid_grant', 'Refresh token does not belong to this client.');
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new OAuthError('invalid_grant', 'Refresh token has expired.');
  }

  // Retire the presented token before minting its replacement, so a crash
  // between the two leaves the client re-authorizing rather than holding two
  // live refresh tokens.
  await db
    .from('mcp_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', tokenHash);

  // The old access token is intentionally left alone: it expires within the
  // hour on its own, and killing it mid-refresh would break in-flight requests
  // the client has already sent.
  return mintTokens({
    authorizationId: row.authorization_id,
    scope: row.scope,
    resource: row.resource,
  });
}

export interface VerifiedToken {
  ownerId: string;
  clientId: string;
  clientName: string;
  scope: string;
  authorizationId: string;
  expiresAt: number;
  /** The RFC 8707 audience this token was minted for, if the client sent one. */
  resource: string | null;
}

/**
 * Authenticate an MCP request. Runs on every tool call, so it is one indexed
 * primary-key lookup and nothing else.
 */
export async function verifyAccessToken(token: string): Promise<VerifiedToken | null> {
  const db = supabaseAdmin();

  const { data: row } = await db
    .from('mcp_tokens')
    // One literal, not a concatenation: supabase-js infers the row type from
    // the select string, and splitting it collapses that to a generic error type.
    .select('authorization_id, scope, resource, expires_at, revoked_at, mcp_authorizations!inner(id, owner_id, client_id, revoked_at, owners!inner(mcp_enabled), mcp_clients!inner(client_name))')
    .eq('token_hash', await hashSecret(token))
    .eq('kind', 'access')
    .maybeSingle();

  if (!row || row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  const grant = row.mcp_authorizations as unknown as {
    owner_id: string;
    client_id: string;
    revoked_at: string | null;
    owners: { mcp_enabled: boolean };
    mcp_clients: { client_name: string };
  };

  if (grant.revoked_at) return null;

  /**
   * The owner's kill switch, joined in above rather than queried separately so
   * it costs nothing to check on every call. Turning MCP off therefore stops
   * every live token immediately, without revoking any grant — so switching it
   * back on restores the connections that were already approved instead of
   * making the owner re-authorize each app.
   */
  if (!grant.owners.mcp_enabled) return null;

  // Best-effort touch so the Connected apps list can show real activity. Never
  // block or fail a tool call over a bookkeeping write.
  void db
    .from('mcp_authorizations')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.authorization_id)
    .then(() => undefined, () => undefined);

  return {
    ownerId: grant.owner_id,
    clientId: grant.client_id,
    clientName: grant.mcp_clients.client_name,
    scope: row.scope,
    authorizationId: row.authorization_id,
    expiresAt: Math.floor(new Date(row.expires_at).getTime() / 1000),
    resource: (row.resource as string | null) ?? null,
  };
}

/**
 * Does a token's recorded audience permit its use against this resource?
 *
 * RFC 8707 binds a token to the server it was requested for. The realistic
 * threat is not a foreign MCP server — a token from one could never be in this
 * database — but the same Pulse reachable under two hostnames: a token minted
 * through a Vercel preview URL should not act on the production domain.
 *
 * A token with no recorded audience is accepted, because `resource` is optional
 * and older or simpler clients omit it; refusing those would break them for a
 * check they never opted into. A token that names a *different* audience is
 * refused, because that one was explicit.
 *
 * Compared on origin + path with any trailing slash removed, so that
 * "https://host/api/mcp/" and "https://host/api/mcp" are the same resource —
 * they are, and a string compare would say otherwise.
 */
export function audienceMatches(tokenResource: string | null, expected: string): boolean {
  if (!tokenResource) return true;

  const canonical = (value: string): string | null => {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
    } catch {
      return null;
    }
  };

  const a = canonical(tokenResource);
  return a !== null && a === canonical(expected);
}

/** RFC 7009. Revoking either token kind is accepted; the endpoint never says which it found. */
export async function revokeToken(token: string): Promise<void> {
  await supabaseAdmin()
    .from('mcp_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', await hashSecret(token))
    .is('revoked_at', null);
}

/** Kill a grant and every token under it. Used by the UI and by reuse detection. */
export async function revokeAuthorization(authorizationId: string): Promise<void> {
  const db = supabaseAdmin();
  const now = new Date().toISOString();

  await db.from('mcp_authorizations').update({ revoked_at: now }).eq('id', authorizationId);
  await db.from('mcp_tokens').update({ revoked_at: now }).eq('authorization_id', authorizationId).is('revoked_at', null);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * An OAuth-shaped failure. `code` is the machine-readable value from RFC 6749
 * §5.2 that clients branch on; `description` is for the human reading the logs.
 */
export class OAuthError extends Error {
  constructor(
    public readonly code: string,
    public readonly description: string,
    public readonly status: number = 400
  ) {
    super(`${code}: ${description}`);
    this.name = 'OAuthError';
  }
}

export function oauthErrorResponse(error: unknown): Response {
  const e =
    error instanceof OAuthError
      ? error
      : new OAuthError('server_error', 'Unexpected error.', 500);

  return Response.json(
    { error: e.code, error_description: e.description },
    {
      status: e.status,
      headers: {
        // Token responses must never be cached: RFC 6749 §5.1 is explicit, and a
        // proxy holding one would serve someone else's credentials.
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    }
  );
}
