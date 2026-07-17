import type { Metadata } from 'next';
import { LoginForm } from './login-form';
import { PulseMark } from '@/components/ui';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-3 flex justify-center">
            <PulseMark size={40} boxed />
          </div>
          <h1 className="font-display text-xl font-bold text-text">Sign in to Pulse</h1>
          <p className="mt-1 text-sm text-text-subtle">Your analytics. Your database. Your call.</p>
        </div>

        <LoginForm next={params.next} initialError={params.error} />

        <p className="mt-6 text-center text-xs text-text-subtle">
          Pulse sets no cookies on the sites it measures. This one is just for your own session.
        </p>
      </div>
    </main>
  );
}
