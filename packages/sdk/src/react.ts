/**
 * React binding.
 *
 * Peer-dependency on react so this file is only pulled in by people who import
 * '@pulse/sdk/react' — the core stays framework-free.
 */

import { useEffect, useRef } from 'react';
import { init, teardown, pageview, track, trackRevenue, type PulseConfig } from './index';

/**
 * Initialize Pulse for the lifetime of a component.
 *
 * ```tsx
 * function App() {
 *   usePulse({ key: 'abc123', host: 'https://pulse.example.com' });
 *   return <Routes />;
 * }
 * ```
 *
 * With Next.js App Router or any router that doesn't call pushState on every
 * navigation, pass `autoPageviews: false` and use usePulsePageviews() instead.
 */
export function usePulse(config: PulseConfig): void {
  // The config object is almost always an inline literal, so a new identity
  // every render. Keying the effect on the values rather than the object stops
  // it from tearing down and rebinding on each render.
  const key = `${config.key}|${config.host}|${config.autoPageviews}|${config.respectDnt}`;
  const ref = useRef(config);
  ref.current = config;

  useEffect(() => {
    init(ref.current);
    return () => teardown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

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
export function usePulsePageviews(path: string | null | undefined): void {
  useEffect(() => {
    if (path === null || path === undefined) return;
    pageview();
  }, [path]);
}

export { track, trackRevenue, pageview, init, teardown };
export type { PulseConfig, Revenue, EventProps } from './index';
