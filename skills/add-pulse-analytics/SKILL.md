---
name: add-pulse-analytics
description: >-
  Integrate Pulse — self-hosted, cookie-free, privacy-first web analytics — into an
  existing website or web app. Use this skill whenever the user wants to add Pulse to a
  project, add analytics / pageview tracking / visitor stats to a site, instrument custom
  events or revenue tracking with Pulse, or mentions @pulse/sdk or px.js. Covers plain
  HTML and static sites, React, Next.js, Vue, Svelte/SvelteKit, and any SSG, plus
  verification and troubleshooting. Reach for it even if the user just says "hook up my
  Pulse instance" or "track signups on my site with pulse" without the word "analytics".
license: MIT
metadata:
  author: DevMello
  source: https://github.com/DevMello/pulse
---

# Add Pulse analytics to an existing web project

Pulse sends three kinds of signal to a self-hosted collector: **pageviews**, **custom
events**, and **revenue**. The client is a thin fire-and-forget transport (~1 KB); all
enrichment happens server-side. No cookies, nothing stored on the device, no consent
banner needed. A correct integration is small — one script tag, or one `init()` call —
so the goal is a minimal diff, not a wrapper layer.

## Step 1 — Gather what you cannot guess

Two values come from the user's Pulse dashboard (Project → Settings). If they weren't
provided, ask before writing code:

1. **Host** — the origin of their Pulse deployment, e.g. `https://pulse.example.com`.
2. **Ingest key** — the project's public ingest key. It is public **by design**: it ships
   in client code, and the project's domain allow-list (not key secrecy) is what blocks
   forged events. So it needs no secret manager — but never invent a value. If the user
   wants to proceed without it, use the placeholder `YOUR_INGEST_KEY` and say clearly at
   the end that it must be replaced.

Then survey the project before choosing an approach:

- Read `package.json` (if any) to detect the framework: `next`, `react`, `vue`,
  `@sveltejs/kit`, `svelte`, `astro`, etc. No `package.json` usually means a static site.
- Find where "every page" lives: a base layout/template, root `layout.tsx`, `App.tsx`,
  `main.ts`, `+layout.svelte`, or plain `index.html`.
- Check for an existing Pulse integration (search for `px.js`, `@pulse/sdk`,
  `data-key`, `window.pulse`). If one exists, fix or extend it — a second initializer is
  the classic cause of doubled pageviews.

## Step 2 — Choose the integration path

Both paths hit the same endpoint and produce identical events, so switching later costs
nothing. Default to the script tag; use the npm SDK when it earns its keep.

| | Script tag | `@pulse/sdk` (npm) |
|---|---|---|
| Install | One `<script>` line | `npm install github:DevMello/pulse#sdk-dist` |
| Best for | Static sites, SSG templates, any HTML page | Bundled SPAs, typed codebases, framework routers |
| Pageviews | Automatic | Automatic, plus router-driven adapters |
| Events / revenue | `pulse(name, props)` global | Typed `track()` / `trackRevenue()` |

**Pick the script tag when** the project renders HTML you can edit (static site, SSG
layout, server templates) and the user mainly wants pageviews.

**Pick the npm SDK when** the project is a bundled SPA (React/Vue/Svelte), uses a router
that bypasses `pushState` (Next.js App Router, vue-router, SvelteKit), or the user wants
typed custom-event/revenue calls throughout the codebase.

## Step 3 — Apply it

### Script tag path

Add one line before `</body>` in the base template that wraps every page:

```html
<script defer data-key="YOUR_INGEST_KEY" src="https://YOUR_PULSE_HOST/px.js"></script>
```

That is the whole integration for pageviews. For configuration (`data-exclude`,
`data-respect-dnt`, manual mode), the `pulse()` global, and the pre-load queue stub,
read [references/script-tag.md](references/script-tag.md).

### npm SDK path

The package is not on the npm registry — install straight from GitHub (the `sdk-dist`
branch holds the prebuilt package, kept in sync on every release):

```bash
npm install github:DevMello/pulse#sdk-dist
```

Then wire `init()` (or a framework adapter) into the app entry point — **once, as high in
the tree as possible**. Read the file that matches the stack:

- React, Next.js, Vue, Svelte/SvelteKit → [references/frameworks.md](references/frameworks.md)
- Vanilla/other bundled apps, full API, config options, TypeScript types → [references/npm-sdk.md](references/npm-sdk.md)

Prefer the project's existing config style for key/host. If the project already uses
public build-time env vars, follow suit (`NEXT_PUBLIC_PULSE_KEY`, `VITE_PULSE_KEY`,
`PUBLIC_PULSE_KEY`, …); otherwise inlining the values is fine — the key is public.

## Pitfalls that actually bite

- **Exactly one pageview driver.** Either `autoPageviews: true` and nothing else, or
  `autoPageviews: false` plus one router hook. Two different drivers double-count.
  (`init()` itself is safe to call repeatedly — React Strict Mode and hot reload do —
  a second call rebinds cleanly.)
- **Some routers skip `pushState`.** Next.js App Router, vue-router, and SvelteKit can
  navigate without it, so the default History patch misses pages. Use the framework
  adapter, which drives pageviews from the router itself. Routers that do use
  `pushState` (e.g. React Router) work with the default.
- **Localhost is skipped by default** (`trackLocalhost` / `data-local` off). This is a
  feature — dev traffic stays out of the data — but it means a local test shows nothing
  unless you temporarily enable it.
- **Admin/preview routes:** offer `exclude: ['/admin*']` (or `data-exclude`) if the
  project has areas the user won't want counted. Trailing `*` is a prefix match.

## Step 4 — Verify

1. Build/typecheck passes with the change in place.
2. Run the site locally with localhost tracking **temporarily** enabled
   (`trackLocalhost: true` or the `data-local` attribute). Open the browser Network tab,
   filter for `event`: each pageview/event POSTs to `<host>/api/event`. **202 = accepted**
   (even quiet rejections return 202); **400 = broken payload**. Revert the localhost
   flag afterwards so dev traffic doesn't pollute production data.
3. On an SPA, navigate between routes and confirm exactly **one** request per navigation
   (pageviews are deduped against the last URL sent, so a double driver shows up here).
4. Remind the user that their production domain must be on the project's domain
   allow-list in the Pulse dashboard, or events will be rejected server-side.

If events don't show up: localhost skipping, a wrong `key`/`host`, a missing allow-list
entry, or a `localStorage.pulse_ignore` flag in that browser are the usual causes.

## Step 5 — Offer instrumentation (don't force it)

Once pageviews land, ask whether the user wants custom events (signups, CTA clicks,
funnel steps) or revenue tracking. Recipes, naming rules, property limits, revenue
semantics (major units, ISO 4217), and the server-side wire format are in
[references/events-revenue.md](references/events-revenue.md). Good instrumentation is a
handful of stable, lowercase `snake_case` events at real decision points — not a tracker
on every button.
