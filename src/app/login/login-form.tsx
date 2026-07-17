'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { inputShell, buttonBase, buttonStyles } from '@/components/form';

/**
 * Magic link sign-in (Section 9).
 *
 * No password option. Pulse is a single-owner instance that most people will
 * sign into a handful of times a year — a password would be one more secret to
 * manage and leak for no gain over an emailed link.
 */
export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(initialError ?? null);

  const redirectTo = () => {
    const url = new URL('/auth/callback', window.location.origin);
    if (next) url.searchParams.set('next', next);
    return url.toString();
  };

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus('sending');

    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo() },
    });

    if (error) {
      setError(error.message);
      setStatus('idle');
      return;
    }
    setStatus('sent');
  }

  if (status === 'sent') {
    return (
      <div className="rounded-xl border border-brand-200 bg-brand-50 p-6 text-center">
        <p className="text-sm font-semibold text-brand-700">Check your email</p>
        <p className="mt-2 text-sm text-text-muted">
          A sign-in link is on its way to <span className="text-text">{email}</span>.
        </p>
        <button
          type="button"
          onClick={() => setStatus('idle')}
          className="mt-4 text-xs text-text-subtle underline hover:text-text"
        >
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={sendMagicLink} className="space-y-3">
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

        <button
          type="submit"
          disabled={status === 'sending' || !email}
          className={`w-full ${buttonBase} ${buttonStyles.primary}`}
        >
          {status === 'sending' ? 'Sending…' : 'Email me a link'}
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
