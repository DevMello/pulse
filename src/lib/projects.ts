import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Project naming and domain rules.
 *
 * Lives outside the server-actions module because the MCP server needs exactly
 * these rules too, and a `'use server'` file can only export async functions —
 * so importing them from there is impossible. Two copies would be worse than
 * impossible: a slug the dashboard accepts and the MCP server rejects is a bug
 * nobody would think to look for.
 */

/** Trailing-`*` globs and exact paths, as stored in `projects.excluded_paths`. */
export function parseDomains(raw: string | string[]): string[] {
  const parts = Array.isArray(raw) ? raw : raw.split(/[\n,\s]+/);

  return parts
    .map((d) => d.trim().toLowerCase())
    // People paste full URLs. Take the host and move on rather than rejecting.
    .map((d) => d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''))
    .filter(Boolean);
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/**
 * First unused slug based on `base`.
 *
 * Racy by construction — two simultaneous creates can pick the same candidate —
 * and that is fine, because `projects_slug_key` is the actual guarantee. This
 * only exists so the common case gets a clean name instead of a constraint
 * violation.
 */
export async function uniqueSlug(db: SupabaseClient, base: string): Promise<string | null> {
  const root = base || 'project';
  // The slug column has a format constraint; a name of only symbols would
  // produce an empty string and a confusing DB error instead of a clear one.
  if (!/^[a-z0-9]/.test(root)) return null;

  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const { data } = await db.from('projects').select('id').eq('slug', candidate).maybeSingle();
    if (!data) return candidate;
  }

  return `${root}-${Date.now().toString(36)}`;
}

/** The one-line install, and the SDK variant for SPAs. */
export function installSnippet(ingestKey: string, origin: string): string {
  return `<script defer data-key="${ingestKey}" src="${origin}/px.js"></script>`;
}

export function sdkSnippet(ingestKey: string, origin: string): string {
  return [
    `npm i @pulse/sdk`,
    ``,
    `import { init, track } from '@pulse/sdk';`,
    ``,
    `init({ key: '${ingestKey}', host: '${origin}' });`,
    ``,
    `track('signup', { plan: 'pro' });`,
    `track('purchase', { revenue: { amount: 29, currency: 'USD' } });`,
  ].join('\n');
}
