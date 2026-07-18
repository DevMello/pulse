# Custom events, revenue, and recipes

## Custom events

A custom event is any named signal that isn't a pageview — a signup, a click, a feature
toggle, a funnel step. Give it a name and, optionally, a flat bag of scalar properties.

```ts
import { track } from '@pulse/sdk';

track('newsletter_subscribe');
track('plan_selected', { plan: 'pro', annual: true, seats: 5 });

// Script-tag equivalent:
// pulse('plan_selected', { plan: 'pro', annual: true, seats: 5 });
```

### Naming rules (enforced server-side)

- Names are trimmed and truncated to **64 characters**.
- An empty name is rejected (`400`).
- `'pageview'` is reserved — it routes to pageview tracking.
- Prefer stable, lowercase, `snake_case` names (`cta_click`) so they group cleanly in
  the dashboard's funnels and event breakdowns.

### Property rules

- Up to **24 keys**; extra keys are dropped.
- String values truncated to **500 characters**.
- Only `string`, finite `number`, and `boolean` are kept. Nested objects/arrays are
  ignored — except the reserved `revenue` object.

## Revenue

Revenue attaches an amount + currency to any event and lands in the **same pipeline** as
Stripe webhooks, so every money query reads one table. Use it for anything not wired to
Stripe: Gumroad, Lemon Squeezy, Paddle, manual invoices, ad payouts.

Two equivalent forms (identical payloads):

```ts
import { track, trackRevenue } from '@pulse/sdk';

trackRevenue('purchase', { amount: 29, currency: 'USD' }, { plan: 'pro' });
track('purchase', { revenue: { amount: 29, currency: 'USD' }, plan: 'pro' });
```

```js
// Script tag — revenue rides inside props
pulse('purchase', { revenue: { amount: 29, currency: 'USD' } });
```

Rules that matter:

- **Amounts are in major units** — pass `29` for $29.00, not `2900`. The collector
  converts to integer minor units server-side (zero-decimal currencies like JPY/KRW and
  three-decimal ones like KWD are handled correctly).
- `amount` must be finite and **≥ 0** — NaN or negative is rejected outright rather than
  coerced, because a corrupted public revenue figure is the one number people check.
- `currency` is ISO 4217, case-insensitive, defaults to `USD` if omitted or malformed.
- A revenue event is **also** a regular event — the purchase event is recorded even if
  the revenue row fails to write (failure is logged server-side, never surfaced to the
  fire-and-forget client).

SDK revenue is stored with `source: 'sdk'` and `kind: 'one_time'`, alongside Stripe rows,
and appears on the dashboard revenue view (and public totals if enabled).

## Recipes

Track outbound link clicks (script tag):

```js
document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (a && a.host !== location.host) {
    pulse('outbound', { href: a.href });
  }
});
```

Track a form submission (SDK):

```ts
import { track } from '@pulse/sdk';

form.addEventListener('submit', () => {
  track('contact_submit', { form: 'homepage' });
});
```

Track a file download:

```js
pulse('download', { file: 'pricing.pdf' });
```

Report revenue from a server-side webhook (no client needed — POST the wire format
directly when a payment provider notifies you of a sale):

```ts
await fetch('https://YOUR_PULSE_HOST/api/event', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: JSON.stringify({
    k: process.env.PULSE_KEY,
    n: 'purchase',
    u: 'https://acme.dev/checkout',
    p: { revenue: { amount: 49, currency: 'USD' }, source: 'gumroad' },
  }),
});
```

Manual pageviews only (wizards/modals counted as steps):

```html
<script defer data-key="YOUR_INGEST_KEY" src="https://YOUR_PULSE_HOST/px.js" data-manual></script>
<script>
  // later, when a step opens:
  pulse('pageview');
</script>
```

## Troubleshooting

Events not showing up — check in this order:

1. On `localhost`? Dev traffic is skipped unless `trackLocalhost` / `data-local` is set.
2. `localStorage.pulse_ignore` set in this browser? Clear with
   `delete localStorage.pulse_ignore`.
3. Domain not on the project's allow-list → events rejected server-side.
4. Wrong `data-key`/`key`, or `host` pointing at the wrong deployment.
5. Network tab, filter `event`: `400` = broken payload; `202` = accepted (quiet
   rejections also return `202` — so a 202 with missing data usually means allow-list
   or exclude rules).

SPA only records the first page → the router bypasses `pushState`; use the framework
adapter or call `pageview()` on route changes.

Double pageviews → two initializations, or auto-tracking left on **and** a manual
driver. Pick one driver. (`init()` itself is idempotent-safe; two *different* drivers
both firing is the problem.)

Cookie banner? Not needed for Pulse itself — no cookies, no storage identifiers, no
personal data retained (same basis Plausible and Umami operate on; not legal advice).
