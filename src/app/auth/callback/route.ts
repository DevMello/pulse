import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * OAuth / magic-link landing.
 *
 * Exchanges the code for a session, then makes sure an `owners` row exists. The
 * database trigger decides whether this account is *allowed* to be the owner
 * (see 20260101000400_owner_claim.sql) — this route just attempts the claim and
 * reports the refusal. Putting the rule in the database means a bug in this
 * route can't hand a stranger the dashboard.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next');

  if (!code) return redirect(url, '/login', { error: 'Missing sign-in code.' });

  const db = await supabaseServer();
  const { error: exchangeError } = await db.auth.exchangeCodeForSession(code);
  if (exchangeError) return redirect(url, '/login', { error: exchangeError.message });

  const { data: { user } } = await db.auth.getUser();
  if (!user) return redirect(url, '/login', { error: 'Sign-in failed.' });

  const { data: existing } = await db.from('owners').select('id').eq('id', user.id).maybeSingle();

  if (!existing) {
    const { error: claimError } = await db
      .from('owners')
      .insert({ id: user.id, email: user.email ?? '' });

    if (claimError) {
      // The trigger refused. Sign back out so the browser isn't left holding a
      // valid session for an account with no access — that state renders an
      // empty dashboard, which looks like a bug rather than a refusal.
      await db.auth.signOut();
      return redirect(url, '/login', {
        error:
          'This Pulse instance already has an owner, or your address is not on its allow-list.',
      });
    }
  }

  return redirect(url, safeNext(next));
}

/**
 * Only same-origin relative paths. Redirecting to an attacker-supplied absolute
 * URL right after establishing a session is a textbook open redirect, and the
 * `next` parameter is fully user-controlled.
 */
function safeNext(next: string | null): string {
  if (!next) return '/app';
  if (!next.startsWith('/') || next.startsWith('//')) return '/app';
  return next;
}

function redirect(base: URL, path: string, params?: Record<string, string>): NextResponse {
  const target = new URL(path, base.origin);
  for (const [k, v] of Object.entries(params ?? {})) target.searchParams.set(k, v);
  return NextResponse.redirect(target);
}
