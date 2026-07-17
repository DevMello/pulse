import type { Metadata } from 'next';
import { LoginForm } from './login-form';
import { supabasePublic } from '@/lib/supabase/server';
import { PulseMark } from '@/components/ui';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * Whether this instance already has an owner. Read through the anon RPC because
 * the login page has no session and `owners` is RLS-locked. If we can't tell
 * (unconfigured deploy, missing migration), fall back to showing the sign-up
 * path — the database trigger still refuses a second owner, so the worst case
 * is a stranger seeing a create button that can't succeed.
 */
async function instanceIsClaimed(): Promise<boolean> {
  try {
    const { data, error } = await supabasePublic().rpc('pulse_owner_exists');
    return error ? false : Boolean(data);
  } catch {
    return false;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const [params, claimed] = await Promise.all([searchParams, instanceIsClaimed()]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-3 flex justify-center">
            <PulseMark size={40} boxed />
          </div>
          <h1 className="font-display text-xl font-bold text-text">
            {claimed ? 'Sign in to Pulse' : 'Set up Pulse'}
          </h1>
          <p className="mt-1 text-sm text-text-subtle">Your analytics. Your database. Your call.</p>
        </div>

        <LoginForm next={params.next} initialError={params.error} ownerExists={claimed} />

        <p className="mt-6 text-center text-xs text-text-subtle">
          Pulse sets no cookies on the sites it measures. This one is just for your own session.
        </p>
      </div>
    </main>
  );
}
