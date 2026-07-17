'use server';

import { supabaseServer } from '@/lib/supabase/server';

/**
 * Ensures an `owners` row exists for the just-authenticated session.
 *
 * With password auth the session is established client-side, so the old
 * magic-link callback route no longer runs. This action takes its place: it is
 * called right after signInWithPassword / signUp succeeds, once the browser
 * client has written the session cookie.
 *
 * The database — not this action — decides who is *allowed* to be the owner
 * (see 20260101000400_owner_claim.sql). We just attempt the claim and report
 * the trigger's refusal. Keeping the rule in the database means a bug here can't
 * hand a stranger the dashboard.
 *
 * On refusal we only report; the caller signs the browser session out, so the
 * cookie the browser client wrote stays the single source of truth rather than
 * being cleared out from under it here.
 */
export async function claimOwnership(): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = await supabaseServer();

  const { data: { user } } = await db.auth.getUser();
  if (!user) return { ok: false, error: 'Sign-in failed.' };

  const { data: existing } = await db.from('owners').select('id').eq('id', user.id).maybeSingle();
  if (existing) return { ok: true };

  const { error } = await db.from('owners').insert({ id: user.id, email: user.email ?? '' });
  if (error) {
    // The trigger refused: this instance already has an owner, or the address
    // is not on its allow-list. A valid session for a non-owner renders an
    // empty dashboard that looks like a bug, so the caller signs it back out.
    return {
      ok: false,
      error: 'This Pulse instance already has an owner, or your address is not on its allow-list.',
    };
  }

  return { ok: true };
}
