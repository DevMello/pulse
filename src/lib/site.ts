import { headers } from 'next/headers';

/**
 * The public origin of this deployment, used to build snippet URLs and badge
 * embeds.
 *
 * Prefers the explicit env var, because that's the one that survives being
 * behind a proxy or a custom domain. Falls back to the request's host so a
 * fork that skipped the setting still shows a working snippet rather than
 * "http://undefined/px.js" — which looks broken and is the first thing a new
 * user sees.
 */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, '');

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host) return 'http://localhost:3000';

  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
