import { SUPPORTED_SCOPES } from '@/lib/mcp/oauth';
import { corsPreflight, issuerUrl, mcpEnabled, resourceUrl, withCors } from '@/lib/mcp/config';

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * Served at /.well-known/oauth-protected-resource via a rewrite.
 *
 * This is the first thing a client reads after the MCP endpoint answers 401
 * with a `WWW-Authenticate` header pointing here. It answers one question —
 * "who authorizes access to this resource?" — and for Pulse the answer is
 * always "this same deployment", since the authorization server and the
 * resource server are the same app.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  if (!(await mcpEnabled())) {
    return withCors(Response.json({ error: 'not_found' }, { status: 404 }));
  }

  return withCors(
    Response.json({
      resource: resourceUrl(req),
      authorization_servers: [issuerUrl(req)],
      scopes_supported: [...SUPPORTED_SCOPES],
      bearer_methods_supported: ['header'],
      resource_documentation: 'https://github.com/DevMello/pulse#mcp-server',
    })
  );
}

export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}
