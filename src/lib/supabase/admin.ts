import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only two callers should ever exist: the ingest collector and the payment
 * webhooks. Both are server-only routes that write rows no user session could
 * be authorized to write.
 *
 * This module must never be imported from a Client Component. The guard below
 * turns that mistake into an immediate crash rather than a leaked key: the key
 * is not prefixed NEXT_PUBLIC_, so it would arrive as undefined in a browser
 * bundle and fail confusingly at runtime instead.
 */
let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Pulse: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required ' +
        'for ingestion. Set them in your Vercel project, or see .env.example.'
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-pulse-client': 'collector' } },
  });

  return cached;
}

/** Whether ingestion is configured. Lets routes 503 cleanly instead of throwing. */
export function ingestConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
