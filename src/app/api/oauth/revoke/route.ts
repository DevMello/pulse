import { revokeToken } from '@/lib/mcp/oauth';
import { corsPreflight, mcpConfigured, mcpEnabled, withCors } from '@/lib/mcp/config';

/**
 * Token revocation (RFC 7009).
 *
 * Always answers 200, even for a token that does not exist, is already dead, or
 * is outright garbage. That is the spec's requirement and it is the right
 * behaviour: a distinguishable response would turn this endpoint into a free
 * oracle for testing whether a stolen string is a live token.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  if (!(await mcpEnabled())) {
    return withCors(Response.json({ error: 'not_found' }, { status: 404 }));
  }

  if (mcpConfigured()) {
    try {
      const form = new URLSearchParams(await req.text());
      const token = form.get('token');
      // token_type_hint is ignored: revokeToken matches on the hash regardless
      // of kind, and the hint is only ever an optimization.
      if (token) await revokeToken(token);
    } catch {
      // Swallowed for the same reason as above — a parse failure must not be
      // distinguishable from a successful revocation.
    }
  }

  return withCors(new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } }));
}

export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}
