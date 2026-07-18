# `@pulse/sdk` — install, core API, configuration

## Install

Not published to the npm registry yet — install straight from GitHub. The `sdk-dist`
branch holds the prebuilt package and is kept in sync automatically on every release, so
this gets exactly what a registry install would (same package name, same import paths):

```bash
npm install github:DevMello/pulse#sdk-dist
# or: pnpm add github:DevMello/pulse#sdk-dist
# or: yarn add github:DevMello/pulse#sdk-dist
```

The package ships ESM and CJS builds with TypeScript declarations, has **no runtime
dependencies**, and is side-effect-free (bundlers tree-shake unused exports). It
reimplements the transport rather than loading `px.js`, so there are zero extra network
requests.

| Entry point | Import | For |
|---|---|---|
| core | `@pulse/sdk` | Framework-agnostic functions |
| react | `@pulse/sdk/react` | React hooks |
| vue | `@pulse/sdk/vue` | Vue plugin + `$pulse` |
| svelte | `@pulse/sdk/svelte` | Svelte / SvelteKit binding |

Every framework entry point re-exports the whole core API.

## Core API — five functions

### `init(config: PulseConfig): void`

Configure Pulse and (unless opted out) start automatic pageview tracking. **Safe to call
more than once** — React Strict Mode and hot reload both do, and a second call rebinds
cleanly rather than doubling every pageview.

```ts
import { init } from '@pulse/sdk';

init({
  key: 'YOUR_INGEST_KEY',
  host: 'https://YOUR_PULSE_HOST',
  autoPageviews: true,     // default
  respectDnt: false,       // default
  trackLocalhost: false,   // default
  exclude: ['/admin*'],    // default: []
});
```

### `track(name: string, props?: EventProps): void`

Record a custom event. The name `'pageview'` is a shortcut that routes to `pageview()`
(and gets its dedupe).

```ts
import { track } from '@pulse/sdk';

track('signup', { plan: 'pro', referrer: 'newsletter' });
track('cta_click');   // props optional
```

### `trackRevenue(name: string, revenue: Revenue, props?: EventProps): void`

Sugar over `track()` — these produce identical payloads:

```ts
trackRevenue('purchase', { amount: 29, currency: 'USD' });
track('purchase', { revenue: { amount: 29, currency: 'USD' } });
```

### `pageview(url?: string): void`

Record a pageview. Defaults to `window.location.href`. Deduped against the last URL
sent, so calling it twice for the same URL is a no-op. Pass an explicit URL when the
router knows the destination before the address bar does.

### `teardown(): void`

Stop automatic tracking, unbind route listeners, restore the original History methods,
forget the config. The framework adapters call this on unmount; rarely needed directly.

## Configuration options

Passed to `init()` and to every framework helper:

| Option | Type | Default | Description |
|---|---|---|---|
| `key` (required) | string | — | Public ingest key. Safe to ship in client code. |
| `host` (required) | string | — | Pulse deployment origin, e.g. `https://pulse.example.com`. Trailing slash is trimmed. |
| `autoPageviews` | boolean | `true` | Track pageviews automatically on History / hash route changes. |
| `respectDnt` | boolean | `false` | Drop events from browsers sending DNT / GPC. |
| `trackLocalhost` | boolean | `false` | Track `localhost` and `file://`. Off keeps dev traffic out of the data. |
| `exclude` | string[] | `[]` | Paths to skip. Trailing `*` = prefix match, e.g. `'/admin*'`. |

## TypeScript types

Exported from every entry point:

```ts
interface PulseConfig {
  key: string;
  host: string;
  autoPageviews?: boolean;   // default true
  respectDnt?: boolean;      // default false
  trackLocalhost?: boolean;  // default false
  exclude?: string[];        // default []
}

interface Revenue {
  amount: number;            // major units — 29 means $29.00
  currency?: string;         // ISO 4217, default 'USD'
}

type EventProps = Record<string, string | number | boolean | Revenue | undefined>;
```

Event properties must be **scalars** (string, finite number, boolean) plus the reserved
`revenue` object. Nested objects and arrays are dropped server-side.
