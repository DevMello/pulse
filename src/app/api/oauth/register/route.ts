import { OAuthError, oauthErrorResponse, registerClient } from '@/lib/mcp/oauth';
import { corsPreflight, mcpConfigured, mcpEnabled, withCors } from '@/lib/mcp/config';
import { clientIp } from '@/lib/enrich/visitor';
import { rateLimit } from '@/lib/ratelimit';

/**
 * Dynamic Client Registration (RFC 7591).
 *
 * Unauthenticated on purpose — this is how an MCP client that has never met
 * this server bootstraps, and requiring a credential here would mean there is
 * no way to obtain one. What makes that acceptable is that a client row is
 * inert: it holds no access, and it only becomes useful when a signed-in owner
 * approves it by name on the consent screen. Until then it is a string in a
 * table that cron sweeps away after a day.
 *
 * The real exposure is volume, not privilege, so it is rate limited.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  if (!(await mcpEnabled())) {
    return withCors(Response.json({ error: 'not_found' }, { status: 404 }));
  }

  if (!mcpConfigured()) {
    return withCors(
      oauthErrorResponse(
        new OAuthError(
          'server_error',
          'This Pulse deployment is missing SUPABASE_SERVICE_ROLE_KEY, which the MCP server requires.',
          503
        )
      )
    );
  }

  // Deliberately tighter than the collector's limit: a legitimate client
  // registers once and then reuses its client_id for the life of the
  // connection, so anything beyond a trickle is either a bug or abuse.
  const limit = rateLimit(`oauth-register:${clientIp(req.headers) ?? 'unknown'}`, {
    ratePerSecond: 0.2,
    burst: 5,
  });

  if (!limit.ok) {
    return withCors(
      new Response(JSON.stringify({ error: 'temporarily_unavailable' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(limit.retryAfter) },
      })
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return withCors(oauthErrorResponse(new OAuthError('invalid_client_metadata', 'Body must be JSON.')));
  }

  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || !redirectUris.every((u) => typeof u === 'string')) {
    return withCors(
      oauthErrorResponse(
        new OAuthError('invalid_redirect_uri', 'redirect_uris is required and must be an array of strings.')
      )
    );
  }

  try {
    const client = await registerClient({
      redirect_uris: redirectUris,
      client_name: typeof body.client_name === 'string' ? body.client_name : undefined,
      client_uri: typeof body.client_uri === 'string' ? body.client_uri : undefined,
      logo_uri: typeof body.logo_uri === 'string' ? body.logo_uri : undefined,
      scope: typeof body.scope === 'string' ? body.scope : undefined,
    });

    return withCors(
      Response.json(
        {
          client_id: client.client_id,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          client_name: client.client_name,
          redirect_uris: client.redirect_uris,
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          // No secret is issued. Saying so explicitly stops a client from
          // waiting for one that will never arrive.
          token_endpoint_auth_method: 'none',
          scope: client.scope,
        },
        { status: 201, headers: { 'Cache-Control': 'no-store' } }
      )
    );
  } catch (error) {
    return withCors(oauthErrorResponse(error));
  }
}

export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}
