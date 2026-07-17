'use client';

import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export function SignOutButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={async () => {
        await supabaseBrowser().auth.signOut();
        // refresh() so the server components re-render without the session,
        // rather than showing stale authenticated markup until the next nav.
        router.push('/login');
        router.refresh();
      }}
      className="text-xs text-text-subtle transition hover:text-text"
    >
      Sign out
    </button>
  );
}
