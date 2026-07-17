'use client';

export function ExportPanel({ slug }: { slug: string }) {
  const exports = [
    { kind: 'events', label: 'Raw events', hint: 'Every event still inside your retention window.' },
    { kind: 'rollups', label: 'Daily rollups', hint: 'Your full history, including periods whose raw events were pruned.' },
    { kind: 'revenue', label: 'Revenue records', hint: 'Every transaction, native currency and converted.' },
  ];

  return (
    <div className="space-y-3 p-4">
      <p className="text-xs leading-relaxed text-ink-600">
        Everything Pulse knows, as CSV or JSON. No request, no queue, no support ticket — it&apos;s
        your database and this just reads it.
      </p>

      <ul className="space-y-2">
        {exports.map((e) => (
          <li key={e.kind} className="flex items-center justify-between gap-3 rounded-lg border border-ink-850 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm text-ink-200">{e.label}</div>
              <div className="text-xs text-ink-600">{e.hint}</div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {(['csv', 'json'] as const).map((format) => (
                <a
                  key={format}
                  href={`/api/export/${slug}?kind=${e.kind}&format=${format}`}
                  // download so the browser saves rather than rendering a
                  // 40 MB JSON blob into a tab.
                  download
                  className="rounded-md border border-ink-800 bg-ink-850 px-2 py-1 text-xs text-ink-300 transition hover:bg-ink-800"
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
