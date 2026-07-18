# Pulse script-tag integration

The tracker is a single self-hosted file — `px.js`, served from the user's own Pulse
deployment. It sets no cookies, writes nothing to storage, and wraps its entire body in
`try/catch`, so a failing analytics call can never break the host page. It is 928 B
gzipped and loads `defer`red.

## The tag

Place before `</body>` (any HTML page, or the base layout/template of an SSG):

```html
<script defer data-key="YOUR_INGEST_KEY" src="https://YOUR_PULSE_HOST/px.js"></script>
```

- `defer` — load without blocking rendering. Recommended, not required.
- `data-key` — **required**. The project's public ingest key. Without it the script does
  nothing and returns silently.
- `src` — points at `/px.js` on the Pulse deployment. The collector origin defaults to
  this URL's origin unless overridden with `data-host`.

All behaviour is configured through `data-*` attributes on that same tag — there is no
separate config object for the script build.

## Configuration: `data-*` attributes

Attributes are read once, from the script tag itself, when the tracker loads. Boolean
flags are toggled by **presence** — the attribute needs no value.

| Attribute | Type | Default | What it does |
|---|---|---|---|
| `data-key` (required) | string | — | Public ingest key. Missing → tracker sends nothing. |
| `data-host` | string | script origin | Override the collector origin (if `px.js` is served from a different host than the Pulse app). |
| `data-manual` | flag | off | Disable automatic pageview tracking; drive pageviews yourself with `pulse()`. |
| `data-respect-dnt` | flag | off | Drop events from browsers sending Do Not Track / Global Privacy Control. |
| `data-local` | flag | off | Also track `localhost`, `127.*`, `::1`, `*.local`, `file://`. Off by default so dev traffic doesn't pollute the data. |
| `data-exclude` | string | — | Comma-separated paths to skip. Trailing `*` = prefix match. |

Fully configured example:

```html
<script
  defer
  data-key="YOUR_INGEST_KEY"
  src="https://YOUR_PULSE_HOST/px.js"
  data-respect-dnt
  data-exclude="/admin*,/preview,/draft*"
></script>
```

Tracks everything except the admin area and preview/draft routes, honours DNT, and keeps
automatic pageviews (since `data-manual` is absent).

Note: each project also has its own **Excluded paths** setting in the Pulse dashboard
that applies server-side to all traffic regardless of the tag. Use `data-exclude` for
per-page-embed control; use the dashboard setting for a project-wide rule.

## The `pulse()` global

Once the script loads it exposes one global, `window.pulse`:

```
pulse(name: string, props?: object) => void
```

```js
// Custom events
pulse('signup', { plan: 'pro' });
pulse('cta_click', { location: 'hero' });
pulse('video_play');            // props optional

// Manual pageview (what you use in data-manual mode)
pulse();            // pageview for the current URL
pulse('pageview');  // identical

// Revenue — rides inside props under the reserved `revenue` key
pulse('purchase', { revenue: { amount: 29, currency: 'USD' }, plan: 'pro' });
```

Pageviews are deduped against the last URL sent, so a router that both calls `pushState`
and emits its own navigation event won't double-count a single route change.

## Calling `pulse()` before the script loads

Because the script is deferred, `window.pulse` may not exist yet when page code runs. If
the page fires events early, add this stub in `<head>`, before any code that might call
`pulse()` — the tracker drains the queue the moment it loads and replays calls in order:

```html
<script>
  window.pulse = window.pulse || function () {
    (pulse.q = pulse.q || []).push(arguments);
  };
</script>
<script defer data-key="YOUR_INGEST_KEY" src="https://YOUR_PULSE_HOST/px.js"></script>
```

## SPA behaviour (automatic mode)

The tracker tracks a pageview on first load and on client-side navigations by wrapping
the History API:

- `history.pushState` → pageview (original still runs)
- `popstate` (back/forward) → pageview
- `hashchange` → pageview (hash routes are recorded as distinct pages, e.g. `/#/settings`)
- `history.replaceState` → **no** pageview (query-param updates and scroll restoration
  aren't real navigations)

The initial pageview is deferred until the page becomes **visible**, so Chrome
prerendering doesn't inflate counts. Frameworks that navigate without `pushState`
(Next.js App Router, vue-router, SvelteKit) can be missed by the History patch — for
those, prefer the npm SDK's framework adapters, or call `pulse('pageview')` on each
route change in `data-manual` mode.
