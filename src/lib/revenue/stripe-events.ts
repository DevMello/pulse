/**
 * Stripe event -> normalized revenue record (Section 8.1).
 *
 * Pure functions, no Stripe SDK and no network: the webhook route verifies the
 * signature and resolves the project, and this decides what the money *means*.
 * That split is what makes the interesting logic — refund signs, MRR
 * classification, currency precision — testable without a Stripe account.
 */

import { convertMinor, type ConvertInput } from '../money';

export type RevenueKind = 'one_time' | 'subscription' | 'refund' | 'dispute';

export interface NormalizedRevenue {
  kind: RevenueKind;
  /** Minor units. Negative for refunds and disputes — see below. */
  amount_cents: number;
  currency: string;
  occurred_at: string;
  external_id: string;
  /** Stripe object ids used to route the money to a project. */
  match: { account?: string; product?: string; price?: string };
}

/**
 * The Stripe events worth listening to.
 *
 * charge.succeeded is deliberately absent: an invoice-paid subscription also
 * emits a charge, and handling both would count every subscription payment
 * twice. Subscriptions are counted from invoices; one-off payments from
 * payment intents.
 */
export const HANDLED_EVENTS = [
  'payment_intent.succeeded',
  'invoice.paid',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
] as const;

export type HandledEvent = (typeof HANDLED_EVENTS)[number];

export function isHandled(type: string): type is HandledEvent {
  return (HANDLED_EVENTS as readonly string[]).includes(type);
}

interface Stripeish {
  id: string;
  type: string;
  account?: string;
  created: number;
  data: { object: Record<string, any> };
}

/**
 * Normalize a verified Stripe event.
 *
 * Returns null for anything that isn't money changing hands — including a $0
 * invoice (free trial) and a dispute that was won, which must not be recorded
 * as revenue or as a loss respectively.
 */
export function normalizeStripeEvent(event: Stripeish): NormalizedRevenue | null {
  const obj = event.data.object;
  const account = event.account;
  const at = (unix: number) => new Date(unix * 1000).toISOString();

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const amount = obj.amount_received ?? obj.amount;
      if (!amount || amount <= 0) return null;

      // A payment intent created by a subscription invoice is already counted
      // via invoice.paid. Counting it here too would double every recurring
      // charge — the most consequential mistake this file can make.
      if (obj.invoice) return null;

      return {
        kind: 'one_time',
        amount_cents: amount,
        currency: String(obj.currency).toUpperCase(),
        occurred_at: at(obj.created ?? event.created),
        external_id: obj.id,
        match: { account, ...productFromMetadata(obj.metadata) },
      };
    }

    case 'invoice.paid': {
      const amount = obj.amount_paid;
      // $0 invoices are trials and plan changes, not revenue.
      if (!amount || amount <= 0) return null;

      const line = obj.lines?.data?.[0];
      const price = line?.price ?? line?.plan;
      // An invoice with a recurring price is MRR; a one-off invoice is not.
      const recurring = Boolean(obj.subscription || price?.recurring || line?.plan);

      return {
        kind: recurring ? 'subscription' : 'one_time',
        amount_cents: amount,
        currency: String(obj.currency).toUpperCase(),
        occurred_at: at(obj.status_transitions?.paid_at ?? obj.created ?? event.created),
        external_id: obj.id,
        match: {
          account,
          product: typeof price?.product === 'string' ? price.product : price?.product?.id,
          price: price?.id,
        },
      };
    }

    case 'charge.refunded': {
      const refunded = obj.amount_refunded;
      if (!refunded || refunded <= 0) return null;

      // Stored negative so that every revenue question stays a plain SUM.
      // A schema where refunds are positive and callers subtract them is one
      // forgotten WHERE clause away from a public number that overstates income
      // — which is exactly the accusation the public page has to survive.
      return {
        kind: 'refund',
        amount_cents: -refunded,
        currency: String(obj.currency).toUpperCase(),
        occurred_at: at(event.created),
        // Keyed on the charge, not the event: Stripe re-emits charge.refunded
        // with a *cumulative* amount_refunded for each partial refund, so a new
        // id per event would double-count. Same id + upsert = the row always
        // holds the current total refunded for that charge.
        external_id: `refund_${obj.id}`,
        match: { account },
      };
    }

    case 'charge.dispute.created': {
      const amount = obj.amount;
      if (!amount || amount <= 0) return null;
      return {
        kind: 'dispute',
        amount_cents: -amount,
        currency: String(obj.currency).toUpperCase(),
        occurred_at: at(event.created),
        external_id: `dispute_${obj.id}`,
        match: { account },
      };
    }

    case 'charge.dispute.closed': {
      // A dispute the owner won returns the money, so the negative row from
      // dispute.created must be reversed to zero rather than left in place.
      // Same external_id as the created event, so the upsert overwrites it.
      const won = obj.status === 'won';
      const amount = obj.amount ?? 0;
      return {
        kind: 'dispute',
        amount_cents: won ? 0 : -amount,
        currency: String(obj.currency).toUpperCase(),
        occurred_at: at(event.created),
        external_id: `dispute_${obj.id}`,
        match: { account },
      };
    }

    default:
      return null;
  }
}

/**
 * Let a one-off payment declare its product, so payment links and Checkout
 * sessions can still route to a project without a price object.
 */
function productFromMetadata(metadata: Record<string, string> | undefined) {
  if (!metadata) return {};
  const product = metadata.pulse_product || metadata.product_id;
  return product ? { product } : {};
}

export interface MappingRow {
  project_id: string;
  match_type: 'account' | 'product' | 'price';
  match_value: string | null;
}

/**
 * Route money to a project, most specific first: price beats product beats
 * account. An account rule with a null value is the catch-all.
 *
 * Returns null when nothing matches, which the route treats as "acknowledge and
 * drop" — recording money against an arbitrary project would be worse than not
 * recording it, because a wrong number is harder to notice than a missing one.
 */
export function resolveProject(
  match: NormalizedRevenue['match'],
  mappings: MappingRow[]
): string | null {
  const byType = (type: MappingRow['match_type'], value: string | undefined) => {
    if (!value) return null;
    return mappings.find((m) => m.match_type === type && m.match_value === value)?.project_id ?? null;
  };

  return (
    byType('price', match.price) ??
    byType('product', match.product) ??
    byType('account', match.account) ??
    mappings.find((m) => m.match_type === 'account' && !m.match_value)?.project_id ??
    null
  );
}

/** Attach the display-currency figure the rollups sum. */
export function withBaseAmount(
  revenue: NormalizedRevenue,
  base: string,
  rates: ConvertInput['rates']
): NormalizedRevenue & { amount_base_cents: number; base_currency: string } {
  return {
    ...revenue,
    amount_base_cents: convertMinor({
      amountMinor: revenue.amount_cents,
      from: revenue.currency,
      to: base,
      rates,
    }),
    base_currency: base,
  };
}
