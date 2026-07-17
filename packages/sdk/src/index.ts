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
  /** Collector origin, e.g. https://pulse.example.com */
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

let config: PulseConfig | null = null;
let lastUrl: string | undefined;
let unbind: (() => void) | null = null;

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

/**
 * Configure Pulse and start auto-tracking.
 *
 * Safe to call more than once — React Strict Mode and hot reload both do. A
 * second call rebinds cleanly rather than doubling every pageview, which is the
 * classic way an SDK like this reports 2x traffic in development and nobody
 * notices until production.
 */
export function init(cfg: PulseConfig): void {
  config = { autoPageviews: true, ...cfg, host: cfg.host.replace(/\/$/, '') };

  if (!isBrowser) return;

  unbind?.();
  unbind = null;

  if (config.autoPageviews) {
    unbind = bindRouteChanges();
    pageview();
  }
}

/** Stop auto-tracking and forget the config. */
export function teardown(): void {
  unbind?.();
  unbind = null;
  config = null;
  lastUrl = undefined;
}

/** Track a custom event. */
export function track(name: string, props?: EventProps): void {
  if (name === 'pageview') {
    pageview();
    return;
  }
  send(name, props);
}

/**
 * Track revenue. Sugar over track() — it produces exactly the payload the
 * collector expects from `track('purchase', { revenue: {...} })`.
 */
export function trackRevenue(
  name: string,
  revenue: Revenue,
  props?: Omit<EventProps, 'revenue'>
): void {
  send(name, { ...props, revenue });
}

/** Track a pageview. Deduped against the last URL sent. */
export function pageview(url?: string): void {
  if (!isBrowser) return;

  const href = url ?? window.location.href;
  if (href === lastUrl) return;
  lastUrl = href;

  send('pageview', undefined, href);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function send(name: string, props?: EventProps, url?: string): void {
  try {
    if (!isBrowser || !config) return;
    if (shouldIgnore()) return;

    const body: Record<string, unknown> = {
      k: config.key,
      n: name,
      u: url ?? window.location.href,
      r: document.referrer || null,
      w: window.innerWidth || 0,
    };
    if (props && Object.keys(props).length > 0) body.p = props;

    const endpoint = `${config.host}/api/event`;
    const json = JSON.stringify(body);

    // text/plain keeps this a CORS simple request — no preflight, one round trip.
    if (!(navigator.sendBeacon && navigator.sendBeacon(endpoint, json))) {
      void fetch(endpoint, {
        method: 'POST',
        body: json,
        keepalive: true,
        headers: { 'Content-Type': 'text/plain' },
      }).catch(() => {});
    }
  } catch {
    // Analytics must never break the host app.
  }
}

function shouldIgnore(): boolean {
  if (!config) return true;

  try {
    if (localStorage.getItem('pulse_ignore')) return true;
  } catch {
    // Blocked storage. Not a reason to skip.
  }

  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  if (config.respectDnt && (nav.doNotTrack === '1' || nav.globalPrivacyControl)) return true;

  const { hostname, protocol, pathname } = window.location;
  if (!config.trackLocalhost && (protocol === 'file:' || /^(localhost|127\.|\[?::1\]?)/.test(hostname))) {
    return true;
  }

  if (config.exclude?.some((p) => (p.endsWith('*') ? pathname.startsWith(p.slice(0, -1)) : p === pathname))) {
    return true;
  }

  return false;
}

/**
 * Bind History API + hash routing.
 *
 * Returns an unbind function, and restores the original pushState on unbind.
 * Monkey-patching History without being able to undo it is how two libraries
 * doing the same thing end up in an infinite wrapper chain.
 */
function bindRouteChanges(): () => void {
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  const onChange = () => pageview();

  history.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
    originalPushState.apply(this, args);
    onChange();
  };

  // replaceState is patched too, but does NOT fire a pageview: routers use it
  // for query-param updates and scroll restoration, which are not navigations.
  // It's wrapped only so unbinding can restore it cleanly.
  history.replaceState = function (this: History, ...args: Parameters<History['replaceState']>) {
    originalReplaceState.apply(this, args);
  };

  window.addEventListener('popstate', onChange);
  window.addEventListener('hashchange', onChange);

  return () => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.removeEventListener('popstate', onChange);
    window.removeEventListener('hashchange', onChange);
  };
}
