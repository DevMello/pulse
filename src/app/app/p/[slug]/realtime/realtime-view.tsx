'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Card, CardHeader, Empty } from '@/components/ui';

/**
 * Realtime (Section 9.2).
 *
 * Polls rather than subscribing. Supabase Realtime would need replication on
 * the busiest table in the database to deliver a number that changes every few
 * seconds and is only ever looked at by one person with the tab open. A 10s
 * poll against an indexed 30-minute window costs less and can't fall behind.
 *
 * Section 13 is explicit that this stack doesn't do millisecond streaming, and
 * at indie scale that's fine.
 */

interface Snapshot {
  online: number;
  perMinute: number[];
  recent: Array<{ name: string; path: string | null; country: string | null; ts: string }>;
}

const POLL_MS = 10_000;

export function RealtimeView({ projectId }: { projectId: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const { data, error } = await supabaseBrowser()
      .from('events')
      .select('name, path, country, ts, visitor_hash')
      .eq('project_id', projectId)
      .gte('ts', since)
      .order('ts', { ascending: false })
      .limit(500);

    if (error) {
      setError(error.message);
      return;
    }
    setError(null);

    const rows = data ?? [];
    const now = Date.now();
    const fiveAgo = now - 5 * 60 * 1000;

    const perMinute = new Array(30).fill(0);
    for (const r of rows) {
      const age = Math.floor((now - new Date(r.ts).getTime()) / 60_000);
      if (age >= 0 && age < 30) perMinute[29 - age] += 1;
    }

    setSnap({
      online: new Set(rows.filter((r) => new Date(r.ts).getTime() > fiveAgo).map((r) => r.visitor_hash)).size,
      perMinute,
      recent: rows.slice(0, 15),
    });
  }, [projectId]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);

    // Stop polling in a background tab. A dashboard left open in a pinned tab
    // for a week would otherwise make ~60k pointless queries.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  const max = Math.max(...(snap?.perMinute ?? [0]), 1);

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader title="Right now" subtitle="Unique visitors in the last 5 minutes" />
        <div className="px-4 py-8 text-center">
          <div className="nums text-5xl font-semibold text-text">
            {snap === null ? '—' : snap.online}
          </div>
          <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-text-subtle">
            {/* Green, not brand indigo: this dot means "connected", and a live
                indicator that matches the nav's active color reads as decoration. */}
            <span className={`h-1.5 w-1.5 rounded-full ${snap ? 'bg-positive-500' : 'bg-ink-400'}`} />
            live · refreshes every {POLL_MS / 1000}s
          </div>
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader title="Last 30 minutes" subtitle="Events per minute" />
        <div className="flex h-32 items-end gap-0.5 px-4 py-4" role="img" aria-label="Events per minute, last 30 minutes">
          {(snap?.perMinute ?? new Array(30).fill(0)).map((v, i) => (
            <div
              key={i}
              className="flex-1 rounded-t bg-brand-500/60"
              // min-height 2px so an empty minute is still a visible tick
              // rather than a gap that reads as missing data.
              style={{ height: `${Math.max((v / max) * 100, 2)}%` }}
              title={`${v} events, ${30 - i}m ago`}
            />
          ))}
        </div>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader title="Event stream" subtitle="Most recent first" />
        {error ? (
          <p className="px-4 py-6 text-sm text-danger-600">{error}</p>
        ) : !snap || snap.recent.length === 0 ? (
          <Empty title="Quiet right now">
            <p>Events appear here within seconds of arriving.</p>
          </Empty>
        ) : (
          <ul className="divide-y divide-border">
            {snap.recent.map((e, i) => (
              <li key={`${e.ts}-${i}`} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-16 shrink-0 text-xs text-text-subtle">{ago(e.ts)}</span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                    e.name === 'pageview' ? 'bg-surface-sunken text-text-muted' : 'bg-brand-500/12 text-brand-700'
                  }`}
                >
                  {e.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-text-muted">{e.path ?? '—'}</span>
                <span className="shrink-0 text-xs text-text-subtle">{e.country ?? ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ago(ts: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  return `${m}m ago`;
}
