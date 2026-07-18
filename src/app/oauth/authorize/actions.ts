'use server';

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getClient, issueAuthorizationCode, normalizeScope } from '@/lib/mcp/oauth';
import { mcpConfigured, mcpEnabled } from '@/lib/mcp/config';

/**
 * What happens when the owner clicks Allow or Cancel.
 *
 * A server action is a public HTTP endpoint. Anything reaching it may have been
 * crafted by hand, may be a replay, and may come from a page the owner never
 * saw — so every check the consent page performed is performed again here from
 * the database, and none of the hidden fields is trusted on its own.
 *
 * The asymmetry is intentional: on any failure this refuses locally rather than
 * redirecting. Once a request is suspect, the redirect target is suspect too,
 * and sending a code — or even an error with the original `state` — to an
 * unverified address is the exact mistake OAuth's redirect rules exist to
 * prevent.
 */

interface ConsentRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scope: string;
  resource: string | null;
}

function readConsent(formData: FormData): ConsentRequest {
  return {
    clientId: String(formData.get('client_id') ?? ''),
    redirectUri: String(formData.get('redirect_uri') ?? ''),
    codeChallenge: String(formData.get('code_challenge') ?? ''),
    state: String(formData.get('state') ?? ''),
    scope: normalizeScope(String(formData.get('scope') ?? '')),
    resource: String(formData.get('resource') ?? '') || null,
  };
}

/**
 * Confirm the request still describes a real client with this exact redirect
 * URI, and that the caller is this instance's owner. Returns null if anything
 * fails, and callers must treat null as "stop", never as "continue without".
 */
async function validate(request: ConsentRequest): Promise<{ ownerId: string } | null> {
  if (!mcpConfigured() || !(await mcpEnabled())) return null;
  if (!request.clientId || !request.redirectUri || !request.codeChallenge) return null;

  const client = await getClient(request.clientId);
  if (!client) return null;
  if (!client.redirect_uris.includes(request.redirectUri)) return null;

  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;

  // The owners row, not just the auth user — same reason as on the page.
  const { data: owner } = await db.from('owners').select('id').eq('id', user.id).maybeSingle();
  if (!owner) return null;

  return { ownerId: owner.id };
}

export async function approveAuthorization(formData: FormData): Promise<void> {
  const request = readConsent(formData);
  const valid = await validate(request);

  if (!valid) redirect('/app?mcp_error=invalid_request');

  const code = await issueAuthorizationCode({
    ownerId: valid.ownerId,
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    scope: request.scope,
    resource: request.resource,
  });

  const destination = new URL(request.redirectUri);
  destination.searchParams.set('code', code);
  // `state` is the client's CSRF defense; echoing it unchanged is the whole
  // point of the parameter, and dropping it makes a correct client reject the
  // response.
  if (request.state) destination.searchParams.set('state', request.state);

  redirect(destination.toString());
}

export async function denyAuthorization(formData: FormData): Promise<void> {
  const request = readConsent(formData);
  const valid = await validate(request);

  // A denial still only goes to a verified address. If validation fails the
  // owner lands back in their dashboard, which is both safe and honest: nothing
  // was granted.
  if (!valid) redirect('/app');

  const destination = new URL(request.redirectUri);
  destination.searchParams.set('error', 'access_denied');
  destination.searchParams.set('error_description', 'The owner declined the request.');
  if (request.state) destination.searchParams.set('state', request.state);

  redirect(destination.toString());
}
