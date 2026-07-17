import type { Metadata } from 'next';
import { LoginForm } from './login-form';

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
            <PulseMark />
          </div>
          <h1 className="text-lg font-semibold text-ink-50">Sign in to Pulse</h1>
          <p className="mt-1 text-sm text-ink-500">Your analytics. Your database. Your call.</p>
        </div>

        <LoginForm next={params.next} initialError={params.error} />

        <p className="mt-6 text-center text-xs text-ink-600">
          Pulse sets no cookies on the sites it measures. This one is just for your own session.
        </p>
      </div>
    </main>
  );
}

function PulseMark() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <rect width="36" height="36" rx="9" fill="var(--color-ink-900)" stroke="var(--color-ink-800)" />
      <path
        d="M7 21.5h5l2.5-8 4 13 3.5-13 2 8H29"
        stroke="var(--color-pulse-500)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
