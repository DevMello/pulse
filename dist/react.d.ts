/**
 * React binding.
 *
 * Peer-dependency on react so this file is only pulled in by people who import
 * '@pulse/sdk/react' — the core stays framework-free.
 */
import { init, teardown, pageview, track, trackRevenue, type PulseConfig } from './index';
/**
 * Initialize Pulse for the lifetime of a component.
 *
 * ```tsx
 * function App() {
 *   usePulse({ key: 'abc123', host: 'https://pulse.devmello.xyz' });
 *   return <Routes />;
 * }
 * ```
 *
 * With Next.js App Router or any router that doesn't call pushState on every
 * navigation, pass `autoPageviews: false` and use usePulsePageviews() instead.
 */
export declare function usePulse(config: PulseConfig): void;
/**
 * Track a pageview whenever the given path changes.
 *
 * For Next.js App Router:
 * ```tsx
 * 'use client';
 * const pathname = usePathname();
 * usePulsePageviews(pathname);
 * ```
 */
export declare function usePulsePageviews(path: string | null | undefined): void;
export { track, trackRevenue, pageview, init, teardown };
export type { PulseConfig, Revenue, EventProps } from './index';
