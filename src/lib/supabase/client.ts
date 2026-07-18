'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/**
 * Browser client. Only the anon key ever reaches this file — RLS is what
 * protects the data, which is exactly why the anon key is safe to publish.
 *
 * Explicit `flowType: 'implicit'`: the default PKCE flow expects a redirect
 * exchange that email/password signUp doesn't produce, causing the gotrue-js
 * client to throw "An unexpected response was received from the server" on
 * every first sign-up. Password auth returns the session directly in the
 * response body, so implicit flow is correct here.
 */
export function supabaseBrowser(): SupabaseClient {
  if (cached) return cached;

  cached = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: 'implicit',
      },
    }
  );
  return cached;
}
