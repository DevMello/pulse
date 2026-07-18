import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Refreshes the Supabase session cookie and gates the dashboard.
 *
 * The auth check here is a redirect, not a security boundary — RLS is the
 * boundary. This exists so an expired session lands on the login page instead
 * of an empty dashboard that looks like data loss.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Unconfigured deploys should reach the setup page and say so, not 500 in
  // middleware where the error is invisible.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet: CookieToSet[]) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser(), not getSession(): getSession trusts the cookie's contents
  // without contacting the auth server, so it can be spoofed. getUser verifies.
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Server actions send POST requests. Redirecting one returns the redirect
  // to the client's server action handler instead of an RSC payload, which
  // throws "An unexpected response was received from the server."
  if (request.method === 'POST') return response;

  if (path.startsWith('/app') && !user) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    // Preserve where they were headed so login returns them there.
    login.searchParams.set('next', path);
    return NextResponse.redirect(login);
  }

  if (path === '/login' && user) {
    const app = request.nextUrl.clone();
    app.pathname = '/app';
    app.search = '';
    return NextResponse.redirect(app);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *  - /api      (collector and webhooks: no session, and the collector is on
     *              the hot path where an auth round trip would be pure cost)
     *  - /stats    (public page: anonymous by definition, and cached)
     *  - /px.js    (the tracker: a static asset)
     *  - static assets
     */
    '/((?!api|stats|px\\.js|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
