'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

/**
 * Magic link + GitHub OAuth (Section 9).
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

  async function signInWithGitHub() {
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: redirectTo() },
    });
    if (error) setError(error.message);
  }

  if (status === 'sent') {
    return (
      <div className="rounded-xl border border-pulse-600/30 bg-pulse-600/5 p-6 text-center">
        <p className="text-sm font-medium text-pulse-400">Check your email</p>
        <p className="mt-2 text-sm text-ink-400">
          A sign-in link is on its way to <span className="text-ink-200">{email}</span>.
        </p>
        <button
          type="button"
          onClick={() => setStatus('idle')}
          className="mt-4 text-xs text-ink-500 underline hover:text-ink-300"
        >
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={signInWithGitHub}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-ink-800 bg-ink-850 px-4 py-2.5 text-sm font-medium text-ink-100 transition hover:bg-ink-800"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
        </svg>
        Continue with GitHub
      </button>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-ink-850" />
        <span className="text-xs text-ink-600">or</span>
        <div className="h-px flex-1 bg-ink-850" />
      </div>

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
            className="w-full rounded-lg border border-ink-800 bg-ink-900 px-3 py-2.5 text-sm text-ink-100 placeholder:text-ink-600 focus:border-pulse-600 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={status === 'sending' || !email}
          className="w-full rounded-lg bg-pulse-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-pulse-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === 'sending' ? 'Sending…' : 'Email me a link'}
        </button>
      </form>

      {error ? (
        <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/5 px-3 py-2 text-xs text-danger-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
