import {
  OAuthError,
  oauthErrorResponse,
  redeemAuthorizationCode,
  refreshTokens,
  type TokenSet,
} from '@/lib/mcp/oauth';
import { corsPreflight, mcpConfigured, mcpEnabled, withCors } from '@/lib/mcp/config';

/**
 * Token endpoint (RFC 6749 §3.2), OAuth 2.1 profile.
 *
 * Two grants, both public-client: `authorization_code` with PKCE, and
 * `refresh_token` with rotation. No client secret is accepted, because none is
 * issued — for a public client a secret shipped inside the app is not a secret,
 * and PKCE already binds the exchange to the instance that started it.
 *
 * Errors from here are intentionally vague. The caller is unauthenticated by
 * definition, and distinguishing "no such code" from "wrong verifier" tells a
 * guesser which half of the guess was right.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  if (!(await mcpEnabled())) {
    return withCors(Response.json({ error: 'not_found' }, { status: 404 }));
  }

  if (!mcpConfigured()) {
    return withCors(
      oauthErrorResponse(
        new OAuthError('server_error', 'This Pulse deployment is missing SUPABASE_SERVICE_ROLE_KEY.', 503)
      )
    );
  }

  let form: URLSearchParams;
  try {
    // The spec mandates form encoding here, but some clients send JSON anyway.
    // Accepting both costs three lines and removes a whole class of support
    // question that surfaces as an unexplained "invalid_request".
    const contentType = req.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const json = (await req.json()) as Record<string, unknown>;
      form = new URLSearchParams(
        Object.entries(json).filter(([, v]) => typeof v === 'string') as [string, string][]
      );
    } else {
      form = new URLSearchParams(await req.text());
    }
  } catch {
    return withCors(oauthErrorResponse(new OAuthError('invalid_request', 'Could not read the request body.')));
  }

  const grantType = form.get('grant_type');
  const clientId = form.get('client_id');

  if (!clientId) {
    return withCors(oauthErrorResponse(new OAuthError('invalid_client', 'client_id is required.', 401)));
  }

  try {
    let tokens: TokenSet;

    switch (grantType) {
      case 'authorization_code': {
        const code = form.get('code');
        const redirectUri = form.get('redirect_uri');
        const codeVerifier = form.get('code_verifier');

        if (!code || !redirectUri || !codeVerifier) {
          throw new OAuthError(
            'invalid_request',
            'code, redirect_uri, and code_verifier are all required.'
          );
        }

        tokens = await redeemAuthorizationCode({ code, clientId, redirectUri, codeVerifier });
        break;
      }

      case 'refresh_token': {
        const refreshToken = form.get('refresh_token');
        if (!refreshToken) throw new OAuthError('invalid_request', 'refresh_token is required.');

        tokens = await refreshTokens(refreshToken, clientId);
        break;
      }

      default:
        throw new OAuthError(
          'unsupported_grant_type',
          `Unsupported grant_type "${grantType ?? ''}". Use authorization_code or refresh_token.`
        );
    }

    return withCors(
      Response.json(
        {
          access_token: tokens.accessToken,
          token_type: 'Bearer',
          expires_in: tokens.expiresIn,
          refresh_token: tokens.refreshToken,
          scope: tokens.scope,
        },
        { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
      )
    );
  } catch (error) {
    return withCors(oauthErrorResponse(error));
  }
}

export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}
