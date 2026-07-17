/**
 * Svelte / SvelteKit binding.
 *
 * SvelteKit navigates without pushState in some cases, so this takes the page
 * store's URL rather than relying on the SDK's History patch.
 */

import { init, teardown, pageview, track, trackRevenue, type PulseConfig } from './index';

interface Readable<T> {
  subscribe(run: (value: T) => void): () => void;
}

/**
 * ```ts
 * // src/routes/+layout.svelte
 * import { page } from '$app/stores';
 * import { pulse } from '@pulse/sdk/svelte';
 *
 * const stop = pulse({ key: 'abc123', host: 'https://pulse.example.com' }, page);
 * onDestroy(stop);
 * ```
 *
 * Returns an unsubscribe function.
 */
export function pulse(
  config: PulseConfig,
  page?: Readable<{ url: URL }>
): () => void {
  // Nothing to track during SSR, and window doesn't exist there.
  if (typeof window === 'undefined') return () => {};

  init({ ...config, autoPageviews: config.autoPageviews ?? !page });

  if (!page) return teardown;

  const unsubscribe = page.subscribe(($page) => {
    // pageview() dedupes on URL, so the store's initial synchronous emit
    // doesn't double-count the first load.
    if ($page?.url) pageview($page.url.href);
  });

  return () => {
    unsubscribe();
    teardown();
  };
}

export { init, teardown, track, trackRevenue, pageview };
export type { PulseConfig, Revenue, EventProps } from './index';
