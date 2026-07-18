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
 * const stop = pulse({ key: 'abc123', host: 'https://pulse.devmello.xyz' }, page);
 * onDestroy(stop);
 * ```
 *
 * Returns an unsubscribe function.
 */
export declare function pulse(config: PulseConfig, page?: Readable<{
    url: URL;
}>): () => void;
export { init, teardown, track, trackRevenue, pageview };
export type { PulseConfig, Revenue, EventProps } from './index';
