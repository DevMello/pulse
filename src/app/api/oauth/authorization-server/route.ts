import { SUPPORTED_SCOPES } from '@/lib/mcp/oauth';
import { corsPreflight, issuerUrl, mcpEnabled, withCors } from '@/lib/mcp/config';

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414).
 *
 * Served at /.well-known/oauth-authorization-server via a rewrite in
 * next.config.ts, because that path is fixed by spec and a Next route segment
 * cannot begin with a dot.
 *
 * This document is the entire handshake: an MCP client that has never seen
 * Pulse before reads it, learns where to register and where to send the owner,
 * and needs no other configuration. Advertising a capability we do not
 * implement is worse than omitting it, so this lists only what actually works.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  if (!(await mcpEnabled())) {
    return withCors(Response.json({ error: 'not_found' }, { status: 404 }));
  }

  const issuer = issuerUrl(req);

  return withCors(
    Response.json({
      issuer,

      // The one endpoint that is a page rather than an API route: it renders
      // the consent screen and needs the owner's Pulse session cookie.
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/api/oauth/token`,
      registration_endpoint: `${issuer}/api/oauth/register`,
      revocation_endpoint: `${issuer}/api/oauth/revoke`,

      scopes_supported: [...SUPPORTED_SCOPES],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],

      // S256 only, and no `plain` fallback — OAuth 2.1 removed it.
      code_challenge_methods_supported: ['S256'],

      // MCP clients are public clients: a desktop app or a browser tab cannot
      // hold a secret, so PKCE does the work a client secret would have done.
      token_endpoint_auth_methods_supported: ['none'],

      revocation_endpoint_auth_methods_supported: ['none'],

      // RFC 8707. Signals that we honour the `resource` parameter, which is how
      // a client tells us which MCP server a token is meant for.
      resource_indicators_supported: true,

      service_documentation: 'https://github.com/DevMello/pulse#mcp-server',
    })
  );
}

export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}
