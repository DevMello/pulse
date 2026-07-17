import Link from 'next/link';
import { redirect } from 'next/navigation';

/**
 * Root.
 *
 * A self-hosted instance has no marketing to do — whoever lands here is either
 * the owner or someone who followed a /stats link. So this is a signpost, not a
 * homepage.
 */
export default function Home() {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  if (!configured) return <SetupNeeded />;

  redirect('/app');
}

function SetupNeeded() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-4">
      <div className="w-full">
        <h1 className="text-xl font-semibold text-ink-50">Pulse isn&apos;t configured yet</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-400">
          Set two environment variables and redeploy. That&apos;s the whole setup.
        </p>

        <pre className="mt-5 overflow-x-auto rounded-lg border border-ink-850 bg-ink-900 p-4 font-mono text-xs leading-relaxed text-ink-300">
          <code>{`NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci…`}</code>
        </pre>

        <p className="mt-4 text-xs leading-relaxed text-ink-600">
          You&apos;ll also want <code className="font-mono text-ink-500">SUPABASE_SERVICE_ROLE_KEY</code>{' '}
          so the collector can write events. Without it Pulse runs read-only.
        </p>

        <p className="mt-6 text-xs text-ink-600">
          Full instructions are in the{' '}
          <Link href="https://github.com/DevMello/pulse#readme" className="text-pulse-400 hover:text-pulse-300">
            README
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
