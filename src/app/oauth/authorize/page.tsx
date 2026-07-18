import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getClient, normalizeScope, SUPPORTED_SCOPES } from '@/lib/mcp/oauth';
import { mcpConfigured, mcpEnabled } from '@/lib/mcp/config';
import { PulseMark } from '@/components/ui';
import { buttonBase, buttonStyles } from '@/components/form';
import { approveAuthorization, denyAuthorization } from './actions';

export const metadata: Metadata = { title: 'Authorize app', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * The consent screen — the only human step in the OAuth flow.
 *
 * Everything else in this feature is machine-to-machine; this page is where a
 * person decides whether an AI agent gets to create projects in their account.
 * So it has one job beyond correctness: make the decision legible. The app's
 * name is attacker-controlled (anyone can register a client called "Pulse
 * Official"), which is exactly why the screen shows the redirect host too —
 * that value was validated against the client's registration and is the part
 * that cannot be faked.
 *
 * Validation order matters and is not cosmetic. An invalid redirect_uri must
 * render an error *here* rather than redirect, because bouncing to an
 * unverified URI is how an open redirect leaks an authorization code. Only once
 * the redirect target is known-good do other errors get sent back to the client.
 */

interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  scope?: string;
  resource?: string;
}

const SCOPE_COPY: Record<string, { title: string; detail: string }> = {
  'projects:read': {
    title: 'See your projects',
    detail: 'Names, domains, timezones, and the ingest key needed to install the tracker.',
  },
  'projects:write': {
    title: 'Create and configure projects',
    detail: 'Add new projects and update their allowed domains. Cannot delete anything or read your analytics.',
  },
};

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<AuthorizeParams>;
}) {
  const params = await searchParams;

  if (!mcpConfigured() || !(await mcpEnabled())) {
    return (
      <Problem
        title="Connecting apps is turned off"
        detail="This Pulse instance is not accepting new app connections right now. If it's yours, you can turn MCP back on under Connected apps in Settings."
      />
    );
  }

  const clientId = params.client_id ?? '';
  const redirectUri = params.redirect_uri ?? '';

  if (!clientId || !redirectUri) {
    return <Problem title="Incomplete request" detail="client_id and redirect_uri are both required." />;
  }

  const client = await getClient(clientId);
  if (!client) {
    return (
      <Problem
        title="Unknown application"
        detail="No app is registered with that client_id. It may have been revoked, or swept up by cleanup if it was never used."
      />
    );
  }

  // Exact string match against what was registered. Not a prefix or origin
  // check: "https://good.example.com.evil.test" passes a prefix test, and
  // "https://good.example.com/../evil" passes a naive origin one.
  if (!client.redirect_uris.includes(redirectUri)) {
    return (
      <Problem
        title="Redirect address not recognized"
        detail={`"${client.client_name}" asked to be sent to an address it never registered. Nothing was authorized. This is what an interception attempt looks like, so it is worth telling the app's authors about.`}
      />
    );
  }

  // Past this point the redirect target is trusted, so protocol errors can be
  // reported to the client the way the spec expects rather than to the human.
  const bounce = (error: string, description: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    url.searchParams.set('error_description', description);
    if (params.state) url.searchParams.set('state', params.state);
    redirect(url.toString());
  };

  if (params.response_type !== 'code') {
    bounce('unsupported_response_type', 'Only response_type=code is supported.');
  }

  // PKCE is not optional in OAuth 2.1, and a missing challenge is the one
  // failure that would silently downgrade the flow's security.
  if (!params.code_challenge) {
    bounce('invalid_request', 'code_challenge is required (PKCE).');
  }

  if ((params.code_challenge_method ?? 'S256') !== 'S256') {
    bounce('invalid_request', 'Only code_challenge_method=S256 is supported.');
  }

  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    // Come back to this exact URL after sign-in. Rebuilt from the parsed params
    // rather than passing the raw query string through, so nothing unexamined
    // survives the round trip.
    const self = new URL('https://placeholder.invalid/oauth/authorize');
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') self.searchParams.set(key, value);
    }
    redirect(`/login?next=${encodeURIComponent(self.pathname + self.search)}`);
  }

  // Being signed in is not the same as being the owner. On a fresh instance an
  // auth user can exist without an owners row, and RLS would then quietly show
  // an empty account rather than an error.
  const { data: owner } = await db.from('owners').select('id, email').eq('id', user.id).maybeSingle();

  if (!owner) {
    return (
      <Problem
        title="This account cannot grant access"
        detail="You are signed in, but this instance's owner is a different account. Only the owner can connect apps."
      />
    );
  }

  const scope = normalizeScope(params.scope ?? client.scope);
  const requested = scope.split(' ').filter((s) => SUPPORTED_SCOPES.includes(s as never));
  const redirectHost = new URL(redirectUri).host;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-3 flex justify-center">
            <PulseMark size={40} boxed />
          </div>
          <h1 className="font-display text-xl font-bold text-text">Connect an app</h1>
          <p className="mt-1 text-sm text-text-subtle">
            Signed in as <span className="font-medium text-text-muted">{owner.email}</span>
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm shadow-ink-950/[0.03]">
          <p className="text-sm text-text">
            {/* Rendered as text by JSX, never as markup — this string came from
                an unauthenticated registration request. */}
            <span className="font-semibold">{client.client_name}</span> wants access to your Pulse
            account.
          </p>

          <p className="mt-2 text-xs text-text-subtle">
            It will be sent back to <span className="font-mono text-text-muted">{redirectHost}</span>.
            If you don&apos;t recognize that address, don&apos;t continue.
          </p>

          <ul className="mt-4 space-y-3 border-t border-border pt-4">
            {requested.map((s) => (
              <li key={s} className="flex gap-2.5">
                <span aria-hidden className="mt-0.5 text-brand-500">✓</span>
                <div>
                  <div className="text-sm font-medium text-text">{SCOPE_COPY[s]?.title ?? s}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-text-subtle">
                    {SCOPE_COPY[s]?.detail ?? ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-4 rounded-lg bg-surface-sunken px-3 py-2 text-xs leading-relaxed text-text-subtle">
            This app will never see your visitors&apos; data, your revenue figures, or your password.
            You can disconnect it any time from Settings.
          </p>

          <div className="mt-5 flex gap-2">
            {/* Two forms rather than one with a submit-button value: a denial
                must not be one typo in a name attribute away from an approval. */}
            <form action={denyAuthorization} className="flex-1">
              <ConsentFields params={params} scope={scope} />
              <button type="submit" className={`${buttonBase} ${buttonStyles.ghost} w-full`}>
                Cancel
              </button>
            </form>

            <form action={approveAuthorization} className="flex-1">
              <ConsentFields params={params} scope={scope} />
              <button type="submit" className={`${buttonBase} ${buttonStyles.primary} w-full`}>
                Allow access
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * The request, carried through the POST.
 *
 * These are hidden inputs, so they are exactly as trustworthy as anything else
 * a browser sends — which is to say not at all. The action re-fetches the
 * client and re-checks the redirect_uri from scratch; nothing here is believed
 * on its own.
 */
function ConsentFields({ params, scope }: { params: AuthorizeParams; scope: string }) {
  return (
    <>
      <input type="hidden" name="client_id" value={params.client_id ?? ''} />
      <input type="hidden" name="redirect_uri" value={params.redirect_uri ?? ''} />
      <input type="hidden" name="code_challenge" value={params.code_challenge ?? ''} />
      <input type="hidden" name="state" value={params.state ?? ''} />
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="resource" value={params.resource ?? ''} />
    </>
  );
}

function Problem({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <div className="mb-3 flex justify-center">
          <PulseMark size={40} boxed />
        </div>
        <h1 className="font-display text-lg font-bold text-text">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-text-subtle">{detail}</p>
      </div>
    </main>
  );
}
