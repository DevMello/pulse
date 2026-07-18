# Framework adapters

Each adapter wires `init()` into the framework's lifecycle and — crucially — drives
pageviews from the framework's own router, which is more reliable than the core History
patch for frameworks that navigate without `pushState`. Adapters are only pulled in when
their entry point is imported; the core stays framework-free.

The rule of thumb for every framework: **one pageview driver**. When a router drives
pageviews, `autoPageviews` must be off (the Vue and Svelte adapters do this for you
automatically when you pass a router/store).

## React — `@pulse/sdk/react`

Two hooks, plus re-exports of the whole core API.

### `usePulse(config)`

Initializes Pulse for the lifetime of the component, tears down on unmount. Keyed on the
config **values**, so an inline config literal doesn't rebind on every render. Mount it
once, high in the tree.

```tsx
import { usePulse, track } from '@pulse/sdk/react';

function App() {
  usePulse({ key: 'YOUR_INGEST_KEY', host: 'https://YOUR_PULSE_HOST' });

  return <button onClick={() => track('cta_click')}>Start</button>;
}
```

For routers that use `pushState` on every navigation (e.g. **React Router**), the
default `autoPageviews` is enough — no second hook needed.

### `usePulsePageviews(path)`

Fires a pageview whenever `path` changes. Use it when the router doesn't go through
`pushState` (see Next.js below). Passing `null`/`undefined` is a no-op, so it's safe
during the first render before a path resolves.

## Next.js App Router

App Router navigations don't always go through `pushState`, so turn off the History
patch and drive pageviews from the pathname instead. Create a client component:

```tsx
'use client';
import { usePathname } from 'next/navigation';
import { usePulse, usePulsePageviews } from '@pulse/sdk/react';

export function Analytics() {
  usePulse({
    key: 'YOUR_INGEST_KEY',
    host: 'https://YOUR_PULSE_HOST',
    autoPageviews: false,
  });
  usePulsePageviews(usePathname());
  return null;
}
```

Render `<Analytics />` once in the root `layout.tsx` (inside `<body>`). It renders
`null`, so it costs nothing visually and initializes tracking on first paint. The root
layout is a server component — that's fine; it can render this client component.

To also count query-string changes as distinct pageviews: combine `usePathname()` with
`useSearchParams()` and pass a joined string to `usePulsePageviews()`. Wrap that
component in `<Suspense>`, as `useSearchParams()` requires.

(Next.js **Pages Router** navigations go through the History API, so the plain
`usePulse` default usually suffices — apply the App Router pattern with the router's
`asPath` only if pageviews are being missed.)

## Vue — `@pulse/sdk/vue`

A plugin plus an optional router hook. It takes a router-*like* object rather than
importing `vue-router`, so it works with vue-router 3 and 4 and forces no dependency.

```ts
import { createApp } from 'vue';
import { createPulse } from '@pulse/sdk/vue';
import App from './App.vue';
import router from './router';

const app = createApp(App);

app.use(createPulse(
  { key: 'YOUR_INGEST_KEY', host: 'https://YOUR_PULSE_HOST' },
  router,
));

app.mount('#app');
```

Passing the router lets its `afterEach` hook drive pageviews — more reliable than
patching History, since vue-router doesn't always go through `pushState`. When a router
is passed, `autoPageviews` defaults to `false` automatically, so nothing double-counts.

The plugin adds a global `$pulse` property (with `track`, `trackRevenue`, `pageview`)
for use in templates:

```html
<button @click="$pulse.track('cta_click')">Start</button>
<button @click="$pulse.trackRevenue('purchase', { amount: 29 })">Buy</button>
```

## Svelte / SvelteKit — `@pulse/sdk/svelte`

SvelteKit navigates without `pushState` in some cases, so the binding takes the `page`
store's URL rather than relying on the History patch. It's SSR-safe: on the server it
returns a no-op, so no `browser` guard is needed.

```svelte
<!-- src/routes/+layout.svelte -->
<script>
  import { onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { pulse } from '@pulse/sdk/svelte';

  const stop = pulse(
    { key: 'YOUR_INGEST_KEY', host: 'https://YOUR_PULSE_HOST' },
    page,
  );
  onDestroy(stop);
</script>
```

`pulse(config, page?)` returns an unsubscribe function — call it in `onDestroy`. Passing
the `page` store makes pageviews follow SvelteKit navigations; the store's initial
synchronous emit is deduped so the first load isn't counted twice. When `page` is
passed, `autoPageviews` defaults to `false`.

For plain Svelte (no SvelteKit router), call `pulse(config)` with no store to fall back
to History-based auto tracking.

## Everything else (Astro, Hugo, Jekyll, Eleventy, server-rendered templates…)

Use the script tag in the base layout that wraps every page — the tracker's automatic
mode handles full page loads and History/hash navigation. See
[script-tag.md](script-tag.md). For an Astro island or any other partially-hydrated
setup, the script tag is still the right call; only reach for the npm core
(`init()`/`track()`) if the user wants typed event calls inside bundled components.
