/**
 * @pulse/sdk — optional typed helpers (Section 4.7).
 *
 * Entirely optional sugar. The plain script tag is fully sufficient and always
 * will be; this exists for people who'd rather import a typed function than call
 * a global, and for SPA frameworks where binding route changes by hand is
 * annoying.
 *
 * It reimplements the transport rather than wrapping the script tag, so that
 * bundler users don't need a second network request for px.js.
 */
export interface PulseConfig {
    /** The project's public ingest key. */
    key: string;
    /** Collector origin, e.g. https://pulse.devmello.xyz */
    host: string;
    /** Track pageviews automatically on route changes. Default true. */
    autoPageviews?: boolean;
    /** Drop events from DNT/GPC browsers. Default false. */
    respectDnt?: boolean;
    /** Track localhost. Default false. */
    trackLocalhost?: boolean;
    /** Paths to skip. Trailing * is a prefix match. */
    exclude?: string[];
}
export interface Revenue {
    amount: number;
    /** ISO 4217. Default USD. */
    currency?: string;
}
export type EventProps = Record<string, string | number | boolean | Revenue | undefined>;
/**
 * Configure Pulse and start auto-tracking.
 *
 * Safe to call more than once — React Strict Mode and hot reload both do. A
 * second call rebinds cleanly rather than doubling every pageview, which is the
 * classic way an SDK like this reports 2x traffic in development and nobody
 * notices until production.
 */
export declare function init(cfg: PulseConfig): void;
/** Stop auto-tracking and forget the config. */
export declare function teardown(): void;
/** Track a custom event. */
export declare function track(name: string, props?: EventProps): void;
/**
 * Track revenue. Sugar over track() — it produces exactly the payload the
 * collector expects from `track('purchase', { revenue: {...} })`.
 */
export declare function trackRevenue(name: string, revenue: Revenue, props?: Omit<EventProps, 'revenue'>): void;
/** Track a pageview. Deduped against the last URL sent. */
export declare function pageview(url?: string): void;
