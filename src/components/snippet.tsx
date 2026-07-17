'use client';

import { useState } from 'react';

/**
 * The copy-paste snippet (Section 4.1). This is the first thing a new user does
 * and the thing they judge the product by, so it is one line and there is a
 * button that puts it on the clipboard.
 */
export function Snippet({ ingestKey, origin }: { ingestKey: string; origin: string }) {
  const [tab, setTab] = useState<'script' | 'npm'>('script');

  const scriptTag = `<script defer data-key="${ingestKey}" src="${origin}/px.js"></script>`;

  const npmSnippet = `npm i @pulse/sdk

import { init, track } from '@pulse/sdk';

init({ key: '${ingestKey}', host: '${origin}' });

// Custom events
track('signup', { plan: 'pro' });

// Revenue
track('purchase', { revenue: { amount: 29, currency: 'USD' } });`;

  return (
    <div>
      <div className="flex gap-1 border-b border-ink-850 px-4">
        {(['script', 'npm'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition ${
              tab === t
                ? 'border-pulse-500 text-ink-100'
                : 'border-transparent text-ink-600 hover:text-ink-300'
            }`}
          >
            {t === 'script' ? 'Script tag' : 'NPM (optional)'}
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === 'script' ? (
          <>
            <p className="mb-3 text-xs text-ink-500">
              Paste before <code className="rounded bg-ink-850 px-1 py-0.5 font-mono">&lt;/body&gt;</code>. That&apos;s
              the whole integration — no cookies, no consent banner, ~1&nbsp;KB.
            </p>
            <CodeBlock code={scriptTag} />
          </>
        ) : (
          <>
            <p className="mb-3 text-xs text-ink-500">
              Optional sugar for SPAs: typed helpers and automatic route tracking. The script tag
              above is already sufficient.
            </p>
            <CodeBlock code={npmSnippet} multiline />
          </>
        )}
      </div>
    </div>
  );
}

export function CodeBlock({ code, multiline = false }: { code: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard is blocked in some contexts (insecure origin, permissions).
      // The code is selectable on screen, so this is a non-event.
    }
  }

  return (
    <div className="relative">
      <pre
        className={`overflow-x-auto rounded-lg border border-ink-850 bg-ink-950 p-3 pr-20 font-mono text-xs leading-relaxed text-ink-300 ${
          multiline ? 'whitespace-pre' : 'whitespace-pre-wrap break-all'
        }`}
      >
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={copy}
        className="absolute top-2 right-2 rounded-md border border-ink-800 bg-ink-850 px-2 py-1 text-xs text-ink-300 transition hover:bg-ink-800"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
