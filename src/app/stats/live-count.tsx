'use client';

import { useEffect, useState } from 'react';

/**
 * "Currently online".
 *
 * Client-side on purpose. The page itself is edge-cached for 5 minutes, which is
 * what makes it free to serve; a live number rendered server-side would force
 * the whole page dynamic and put every viral visitor onto the database. This
 * fetches one integer from a cheap endpoint instead.
 *
 * Renders nothing at all if the owner disabled the live count or nobody's around
 * — an empty "0 online" badge is a worse look than no badge.
 */
export function LiveCount({ slug }: { slug?: string }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const url = slug ? `/api/live?slug=${encodeURIComponent(slug)}` : '/api/live';
        const res = await fetch(url);
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setCount(json.online ?? 0);
      } catch {
        // Offline, blocked, whatever. The badge just doesn't appear.
      }
    }

    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [slug]);

  if (count === null || count === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-full border border-positive-600/25 bg-positive-500/10 px-3 py-1.5">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive-500 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-positive-500" />
      </span>
      <span className="nums text-xs font-semibold text-positive-700">
        {count} online now
      </span>
    </div>
  );
}
