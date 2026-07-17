import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Server-side client carrying the owner's session.
 *
 * Runs as `authenticated`, so RLS applies to every query. That is the point:
 * dashboard code cannot leak another user's rows even if a filter is forgotten,
 * because the database refuses rather than trusting the WHERE clause.
 */
export async function supabaseServer(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet: CookieToSet[]) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components can't set cookies. Harmless: middleware
            // refreshes the session on every request, so the write here is
            // redundant rather than required.
          }
        },
      },
    }
  );
}

/**
 * The anon client used to render the public stats page.
 *
 * Deliberately session-free and separate from supabaseServer(): the public page
 * must be able to read *only* what the public RPCs expose. Rendering it with a
 * client that happens to carry the owner's cookies would silently show the
 * owner their own hidden metrics and make the visibility toggles untestable in
 * the one browser that matters most — the owner's.
 */
export function supabasePublic(): SupabaseClient {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Pulse: ${name} is not set. Copy .env.example to .env.local and fill in your ` +
        `Supabase URL and anon key, or set them in your Vercel project.`
    );
  }
  return value;
}
