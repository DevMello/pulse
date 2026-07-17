'use client';

export function ExportPanel({ slug }: { slug: string }) {
  const exports = [
    { kind: 'events', label: 'Raw events', hint: 'Every event still inside your retention window.' },
    { kind: 'rollups', label: 'Daily rollups', hint: 'Your full history, including periods whose raw events were pruned.' },
    { kind: 'revenue', label: 'Revenue records', hint: 'Every transaction, native currency and converted.' },
  ];

  return (
    <div className="space-y-3 p-4">
      <p className="text-xs leading-relaxed text-text-subtle">
        Everything Pulse knows, as CSV or JSON. No request, no queue, no support ticket — it&apos;s
        your database and this just reads it.
      </p>

      <ul className="space-y-2">
        {exports.map((e) => (
          <li key={e.kind} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm text-text">{e.label}</div>
              <div className="text-xs text-text-subtle">{e.hint}</div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {(['csv', 'json'] as const).map((format) => (
                <a
                  key={format}
                  href={`/api/export/${slug}?kind=${e.kind}&format=${format}`}
                  // download so the browser saves rather than rendering a
                  // 40 MB JSON blob into a tab.
                  download
                  className="rounded-md border border-border-strong bg-surface-sunken px-2 py-1 text-xs text-text transition hover:bg-surface-sunken"
                >
                  {format.toUpperCase()}
                </a>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
