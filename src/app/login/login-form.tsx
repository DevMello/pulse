'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { safeNext } from '@/lib/safe-next';
import { claimOwnership } from './actions';
import { inputShell, buttonBase, buttonStyles } from '@/components/form';

/**
 * Email + password sign-in (Section 9).
 *
 * Pulse is a single-owner instance. On a fresh install there is no account yet,
 * so the form doubles as the one-time owner sign-up: "Create the owner account"
 * calls signUp, and the database trigger decides whether that address is
 * allowed to claim the instance (allow-list, or first-wins). Afterwards it is a
 * plain sign-in. No email round trip either way — which does mean the Supabase
 * project must have "Confirm email" turned off, or signUp waits on a link.
 */
type Mode = 'signin' | 'signup';

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const supabase = supabaseBrowser();

    const { data, error: authError } =
      mode === 'signup'
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(authError.message);
      setBusy(false);
      return;
    }

    // signUp with "Confirm email" still enabled returns no session — the account
    // exists but is unusable until a link is clicked, which is exactly the email
    // dependency password auth is meant to avoid. Say so plainly.
    if (!data.session) {
      setError(
        'Account created, but this Supabase project still requires email confirmation. ' +
          'Turn off "Confirm email" in Authentication → Providers → Email, then sign in.',
      );
      setMode('signin');
      setBusy(false);
      return;
    }

    // The browser client has written the session cookie; make sure an owners row
    // exists (and that the trigger allows this account to be the owner).
    const claim = await claimOwnership();
    if (!claim.ok) {
      await supabase.auth.signOut();
      setError(claim.error);
      setBusy(false);
      return;
    }

    router.push(safeNext(next));
    router.refresh();
  }

  const isSignup = mode === 'signup';

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label htmlFor="email" className="sr-only">
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputShell}
          />
        </div>

        <div>
          <label htmlFor="password" className="sr-only">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isSignup ? 'Choose a password (8+ characters)' : 'Password'}
            className={inputShell}
          />
        </div>

        <button
          type="submit"
          disabled={busy || !email || !password}
          className={`w-full ${buttonBase} ${buttonStyles.primary}`}
        >
          {busy
            ? isSignup
              ? 'Creating…'
              : 'Signing in…'
            : isSignup
              ? 'Create the owner account'
              : 'Sign in'}
        </button>
      </form>

      {error ? (
        <p role="alert" className="rounded-lg border border-danger-600/25 bg-danger-500/8 px-3 py-2 text-xs text-danger-700">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setMode(isSignup ? 'signin' : 'signup');
          setError(null);
        }}
        className="block w-full text-center text-xs text-text-subtle underline hover:text-text"
      >
        {isSignup ? 'Already set up? Sign in' : 'First run? Create the owner account'}
      </button>
    </div>
  );
}
