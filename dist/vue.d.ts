/**
 * Vue binding.
 *
 * A plugin plus a router hook. Framework-agnostic on purpose: it takes a
 * router-like object rather than importing vue-router, so it works with
 * vue-router 3 and 4 and doesn't force the dependency on people who route some
 * other way.
 */
import { init, teardown, pageview, track, trackRevenue, type PulseConfig } from './index';
interface RouterLike {
    afterEach(hook: (to: {
        fullPath: string;
    }) => void): void;
}
interface AppLike {
    config: {
        globalProperties: Record<string, unknown>;
    };
}
/**
 * ```ts
 * import { createPulse } from '@pulse/sdk/vue';
 *
 * app.use(createPulse({ key: 'abc123', host: 'https://pulse.devmello.xyz' }, router));
 * ```
 *
 * Adds `$pulse` for use in templates: `@click="$pulse.track('cta_click')"`.
 */
export declare function createPulse(config: PulseConfig, router?: RouterLike): {
    install(app: AppLike): void;
};
export { init, teardown, track, trackRevenue, pageview };
export type { PulseConfig, Revenue, EventProps } from './index';
