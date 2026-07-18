'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { safeNext } from '@/lib/safe-next';
import { passwordStrength } from '@/lib/password-strength';
import { claimOwnership } from './actions';
import { inputShell, buttonBase, buttonStyles } from '@/components/form';

/**
 * Email + password sign-in (Section 9).
 *
 * Pulse is a single-owner instance. Until the instance is claimed the form
 * doubles as the one-time owner sign-up: "Create the owner account" calls
 * signUp, and the database trigger decides whether that address is allowed to
 * claim (allow-list, or first-wins). Once an owner exists (`ownerExists`) the
 * sign-up path — and its toggle — disappear: there is nothing left to create,
 * and a second signup would only ever be refused. No email round trip either
 * way, which does mean the Supabase project must have "Confirm email" off.
 */
type Mode = 'signin' | 'signup';

export function LoginForm({
  next,
  initialError,
  ownerExists,
}: {
  next?: string;
  initialError?: string;
  ownerExists: boolean;
}) {
  const router = useRouter();
  const canSignUp = !ownerExists;
  const [mode, setMode] = useState<Mode>(canSignUp ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const isSignup = mode === 'signup';
  const passwordsMatch = password === confirm;
  const showMismatch = isSignup && confirm.length > 0 && !passwordsMatch;
  const disabled =
    busy || !email || !password || (isSignup && (password.length < 8 || !passwordsMatch));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setError(null);
    setBusy(true);

    try {
      const supabase = supabaseBrowser();

      const { data, error: authError } = isSignup
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setBusy(false);
    }
  }

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
            minLength={isSignup ? 8 : undefined}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isSignup ? 'Choose a password (8+ characters)' : 'Password'}
            className={inputShell}
          />
          {isSignup && password.length > 0 ? <StrengthMeter password={password} /> : null}
        </div>

        {isSignup ? (
          <div>
            <label htmlFor="confirm" className="sr-only">
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm password"
              aria-invalid={showMismatch}
              className={inputShell}
            />
            {showMismatch ? (
              <p className="mt-1.5 text-xs text-danger-700">Passwords don’t match.</p>
            ) : null}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={disabled}
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

    </div>
  );
}

/** Four-segment strength hint shown while choosing the owner password. */
function StrengthMeter({ password }: { password: string }) {
  const { score, label } = passwordStrength(password);
  const bar = ['', 'bg-danger-500', 'bg-warn-500', 'bg-brand-500', 'bg-positive-500'][score];
  const text = [
    'text-text-subtle',
    'text-danger-700',
    'text-warn-700',
    'text-brand-700',
    'text-positive-700',
  ][score];

  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${i <= score ? bar : 'bg-surface-sunken'}`}
          />
        ))}
      </div>
      <p className={`mt-1 text-xs ${text}`}>{label}</p>
    </div>
  );
}
