/**
 * Stripe webhook (Section 8.1 / 11).
 *
 * Node runtime, not edge: signature verification needs the raw body bytes, and
 * Stripe's SDK uses node crypto for the constant-time compare.
 */

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { supabaseAdmin, ingestConfigured } from '@/lib/supabase/admin';
import {
  normalizeStripeEvent,
  resolveProject,
  withBaseAmount,
  isHandled,
  type MappingRow,
} from '@/lib/revenue/stripe-events';
import { displayCurrency, parseFxRates } from '@/lib/money';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const apiKey = process.env.STRIPE_SECRET_KEY;

  if (!secret || !apiKey || !ingestConfigured()) {
    return NextResponse.json({ error: 'stripe not configured' }, { status: 503 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'missing signature' }, { status: 400 });

  // Raw body. Parsing before verifying would defeat the point of verifying.
  const payload = await req.text();
  // Pinned, not floating: an account whose default API version moves would
  // otherwise start sending a different event shape to a webhook that was
  // never redeployed, and the first symptom would be missing revenue.
  const stripe = new Stripe(apiKey, { apiVersion: '2025-02-24.acacia' });

  let event: Stripe.Event;
  try {
    // Verifies HMAC and the timestamp tolerance, so a captured payload can't be
    // replayed later. Anyone who knows the URL can POST to it; this is the only
    // thing that makes the request trustworthy.
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid signature';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!isHandled(event.type)) {
    // 200, not 4xx: Stripe retries non-2xx, and an event we don't care about is
    // not a failure. Telling Stripe otherwise means it retries forever.
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const revenue = normalizeStripeEvent(event as never);
  if (!revenue) return NextResponse.json({ received: true, ignored: 'no revenue' });

  const db = supabaseAdmin();

  const { data: mappings, error: mappingError } = await db
    .from('revenue_mappings')
    .select('project_id, match_type, match_value')
    .eq('source', 'stripe');

  if (mappingError) {
    // 500 so Stripe retries: this is our failure, and the money is real.
    return NextResponse.json({ error: 'mapping lookup failed' }, { status: 500 });
  }

  const projectId = resolveProject(revenue.match, (mappings ?? []) as MappingRow[]);
  if (!projectId) {
    // Acknowledged, not retried: no mapping is a configuration gap that a retry
    // cannot fix. Surfaced in the dashboard's integrations page instead.
    return NextResponse.json({ received: true, ignored: 'no project mapping' });
  }

  const record = withBaseAmount(revenue, displayCurrency(), parseFxRates(process.env.PULSE_FX_RATES));

  // Upsert on (source, external_id). Stripe guarantees at-least-once delivery,
  // so redelivery is normal traffic, not an error — this makes it a no-op.
  // It also lets charge.refunded's cumulative amount overwrite the prior total
  // instead of stacking.
  const { error: writeError } = await db.from('revenue_records').upsert(
    {
      project_id: projectId,
      source: 'stripe',
      kind: record.kind,
      amount_cents: record.amount_cents,
      currency: record.currency,
      amount_base_cents: record.amount_base_cents,
      base_currency: record.base_currency,
      occurred_at: record.occurred_at,
      external_id: record.external_id,
      recurring_interval: record.recurring?.interval ?? null,
      recurring_interval_count: record.recurring?.interval_count ?? null,
    },
    { onConflict: 'source,external_id' }
  );

  if (writeError) {
    return NextResponse.json({ error: 'write failed' }, { status: 500 });
  }

  await db
    .from('integrations')
    .update({ meta: { last_event_at: new Date().toISOString(), last_event_type: event.type } })
    .eq('provider', 'stripe');

  return NextResponse.json({ received: true });
}
