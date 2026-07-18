# @pulse/sdk

Typed client for [Pulse](https://github.com/DevMello/pulse) — privacy-first, self-hosted analytics with revenue tracking.

**This package is optional.** The plain script tag does everything the SDK does:

```html
<script defer data-key="YOUR_KEY" src="https://pulse.devmello.xyz/px.js"></script>
```

Use the SDK if you'd rather have typed helpers and automatic route tracking wired into your framework.

## Install

Not on npm yet — install directly from GitHub instead. The `sdk-dist` branch holds the prebuilt package, kept in sync via `npm run publish:sdk-branch` in the main repo.

```sh
npm install github:DevMello/pulse#sdk-dist
# or
pnpm add github:DevMello/pulse#sdk-dist
# or
yarn add github:DevMello/pulse#sdk-dist
```

## Core

```ts
import { init, track, trackRevenue } from '@pulse/sdk';

init({
  key: 'YOUR_INGEST_KEY',
  host: 'https://pulse.devmello.xyz',
});

track('signup', { plan: 'pro' });
trackRevenue('purchase', { amount: 29, currency: 'USD' }, { plan: 'pro' });
```

### Options

| Option | Default | What it does |
|---|---|---|
| `key` | — | Your project's public ingest key. Safe to ship in client code. |
| `host` | — | Your Pulse deployment's origin. |
| `autoPageviews` | `true` | Track pageviews on History/hash route changes. |
| `respectDnt` | `false` | Drop events from DNT/GPC browsers. |
| `trackLocalhost` | `false` | Track `localhost` and `file://`. |
| `exclude` | `[]` | Paths to skip. Trailing `*` is a prefix match. |

## React

```tsx
import { usePulse, track } from '@pulse/sdk/react';

function App() {
  usePulse({ key: 'YOUR_KEY', host: 'https://pulse.devmello.xyz' });
  return <button onClick={() => track('cta_click')}>Start</button>;
}
```

### Next.js App Router

App Router navigations don't always go through `pushState`, so drive pageviews from the pathname instead:

```tsx
'use client';
import { usePathname } from 'next/navigation';
import { usePulse, usePulsePageviews } from '@pulse/sdk/react';

export function Analytics() {
  usePulse({ key: 'YOUR_KEY', host: 'https://pulse.devmello.xyz', autoPageviews: false });
  usePulsePageviews(usePathname());
  return null;
}
```

## Vue

```ts
import { createPulse } from '@pulse/sdk/vue';

app.use(createPulse({ key: 'YOUR_KEY', host: 'https://pulse.devmello.xyz' }, router));
```

Passing the router lets `afterEach` drive pageviews, which is more reliable than patching History. `$pulse` is available in templates:

```vue
<button @click="$pulse.track('cta_click')">Start</button>
```

## Svelte / SvelteKit

```svelte
<!-- src/routes/+layout.svelte -->
<script>
  import { onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { pulse } from '@pulse/sdk/svelte';

  const stop = pulse({ key: 'YOUR_KEY', host: 'https://pulse.devmello.xyz' }, page);
  onDestroy(stop);
</script>
```

## Revenue

`trackRevenue` is sugar over `track` — both produce the same payload:

```ts
trackRevenue('purchase', { amount: 29, currency: 'USD' });
track('purchase', { revenue: { amount: 29, currency: 'USD' } });
```

Amounts are in major units (29 means $29.00). Zero-decimal currencies like JPY are handled correctly server-side. Revenue sent this way lands in the same pipeline as Stripe webhooks, so it shows up alongside automatic revenue on the dashboard and public page.

## Opting out

Set `localStorage.pulse_ignore = '1'` in any browser you don't want counted — your own, mainly. The SDK reads this flag and never writes it. It sets no cookies and stores nothing.

## License

MIT
