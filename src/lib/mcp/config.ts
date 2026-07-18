import { getPublicOrigin } from 'mcp-handler';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Shared facts about where the MCP server lives and whether it is turned on.
 *
 * Every URL here is derived from the incoming request rather than from
 * NEXT_PUBLIC_SITE_URL. OAuth metadata is one of the few places where "close
 * enough" is a real failure: the issuer a client reads must byte-match the
 * origin it fetched from, or the client rejects the whole discovery document.
 * A fork running locally with NEXT_PUBLIC_SITE_URL still pointed at production
 * would otherwise advertise endpoints on the wrong host.
 */

/**
 * Whether this instance answers MCP and OAuth requests at all.
 *
 * Owner-controlled from /app/settings and on by default. It is read from the
 * database rather than an env var so that switching it off takes effect on the
 * next request — the moment someone wants it off is the moment they have seen
 * something they don't like, and "edit Vercel, redeploy, wait" is not a kill
 * switch.
 *
 * Deliberately not cached. This gates every request into the feature, and a
 * cache would put a window between the owner flipping the toggle and the
 * feature actually stopping. That window is the entire thing the toggle exists
 * to eliminate, and the cost of avoiding it is one indexed read of a
 * single-row table.
 *
 * Returns false when the database is unreachable or the instance is unclaimed:
 * an error here must fail closed, because the alternative is a transient
 * outage silently un-disabling a feature the owner turned off.
 */
export async function mcpEnabled(): Promise<boolean> {
  if (!mcpConfigured()) return false;

  try {
    const { data, error } = await supabaseAdmin().rpc('pulse_mcp_enabled');
    return error ? false : Boolean(data);
  } catch {
    return false;
  }
}

/**
 * The MCP server needs the service role key, because the OAuth tables are
 * service_role-only and there is no user session on an MCP request to satisfy
 * RLS with. Reported separately from the owner's toggle so a misconfigured
 * deploy can say which half is missing rather than looking switched off.
 */
export function mcpConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export function originOf(req: Request): string {
  return getPublicOrigin(req).replace(/\/$/, '');
}

/**
 * The protected resource identifier (RFC 8707), and the URL clients connect to.
 * Must be identical in the metadata, in the `resource` parameter, and in the
 * audience recorded on a token — that three-way match is what stops a token
 * minted for this Pulse from being replayed against another MCP server.
 */
export function resourceUrl(req: Request): string {
  return `${originOf(req)}/api/mcp`;
}

/** Pulse is its own authorization server, so the issuer is just the origin. */
export function issuerUrl(req: Request): string {
  return originOf(req);
}

/**
 * Cross-origin access for browser-based MCP clients.
 *
 * claude.ai and chatgpt.com run the client in a web page, so discovery, token
 * exchange, and every tool call are cross-origin fetches. Wide-open CORS is
 * correct here rather than lax: these endpoints are authenticated by a bearer
 * token, never by a cookie, so there is no ambient authority for a hostile
 * page to ride. `Mcp-Session-Id` and `WWW-Authenticate` must be exposed or the
 * client cannot read the session header or discover where to authenticate.
 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-Id',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate',
  'Access-Control-Max-Age': '86400',
};

export function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
