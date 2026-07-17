import { describe, it, expect } from 'vitest';
import {
  normalizeStripeEvent,
  resolveProject,
  withBaseAmount,
  isHandled,
  type MappingRow,
} from '../revenue/stripe-events';

const at = 1_700_000_000;

function event(type: string, object: Record<string, unknown>, account?: string) {
  return { id: 'evt_1', type, account, created: at, data: { object } } as never;
}

describe('isHandled', () => {
  it('ignores charge.succeeded to avoid double counting subscriptions', () => {
    // An invoice-paid subscription also emits charge.succeeded. Handling both
    // would count every recurring payment twice.
    expect(isHandled('charge.succeeded')).toBe(false);
    expect(isHandled('invoice.paid')).toBe(true);
    expect(isHandled('customer.created')).toBe(false);
  });
});

describe('payment_intent.succeeded', () => {
  it('records a one-off payment', () => {
    const r = normalizeStripeEvent(
      event('payment_intent.succeeded', {
        id: 'pi_1', amount_received: 2900, currency: 'usd', created: at,
      }, 'acct_1')
    );
    expect(r).toMatchObject({ kind: 'one_time', amount_cents: 2900, currency: 'USD', external_id: 'pi_1' });
    expect(r?.match.account).toBe('acct_1');
  });

  it('skips a payment intent attached to an invoice', () => {
    // This is the double-count guard: the invoice.paid event already counted it.
    const r = normalizeStripeEvent(
      event('payment_intent.succeeded', {
        id: 'pi_2', amount_received: 2900, currency: 'usd', invoice: 'in_1', created: at,
      })
    );
    expect(r).toBeNull();
  });

  it('skips a zero amount', () => {
    expect(normalizeStripeEvent(event('payment_intent.succeeded', { id: 'pi_3', amount_received: 0, currency: 'usd' }))).toBeNull();
  });
});

describe('invoice.paid', () => {
  it('classifies a recurring price as subscription revenue', () => {
    const r = normalizeStripeEvent(
      event('invoice.paid', {
        id: 'in_1', amount_paid: 1900, currency: 'usd', subscription: 'sub_1',
        status_transitions: { paid_at: at },
        lines: { data: [{ price: { id: 'price_1', product: 'prod_1', recurring: { interval: 'month' } } }] },
      }, 'acct_1')
    );
    expect(r).toMatchObject({ kind: 'subscription', amount_cents: 1900 });
    expect(r?.match).toEqual({ account: 'acct_1', product: 'prod_1', price: 'price_1' });
  });

  it('classifies a one-off invoice as one_time', () => {
    const r = normalizeStripeEvent(
      event('invoice.paid', {
        id: 'in_2', amount_paid: 5000, currency: 'usd',
        lines: { data: [{ price: { id: 'price_2', product: 'prod_2' } }] },
      })
    );
    expect(r?.kind).toBe('one_time');
  });

  it('skips a $0 trial invoice', () => {
    const r = normalizeStripeEvent(
      event('invoice.paid', { id: 'in_3', amount_paid: 0, currency: 'usd', subscription: 'sub_1' })
    );
    expect(r).toBeNull();
  });

  it('handles an expanded product object', () => {
    const r = normalizeStripeEvent(
      event('invoice.paid', {
        id: 'in_4', amount_paid: 1000, currency: 'usd', subscription: 'sub_2',
        lines: { data: [{ price: { id: 'price_3', product: { id: 'prod_3' }, recurring: { interval: 'year' } } }] },
      })
    );
    expect(r?.match.product).toBe('prod_3');
  });

  it('respects zero-decimal currencies', () => {
    // 1000 JPY is ¥1000, not ¥10. Stripe sends whole units for JPY.
    const r = normalizeStripeEvent(
      event('invoice.paid', { id: 'in_5', amount_paid: 1000, currency: 'jpy', subscription: 's' })
    );
    expect(r).toMatchObject({ amount_cents: 1000, currency: 'JPY' });
  });
});

describe('refunds', () => {
  it('stores a refund as a negative amount', () => {
    const r = normalizeStripeEvent(
      event('charge.refunded', { id: 'ch_1', amount_refunded: 900, currency: 'usd' })
    );
    expect(r).toMatchObject({ kind: 'refund', amount_cents: -900 });
  });

  it('keys on the charge so a second partial refund overwrites rather than stacks', () => {
    // Stripe re-sends charge.refunded with a cumulative amount_refunded.
    const first = normalizeStripeEvent(event('charge.refunded', { id: 'ch_2', amount_refunded: 500, currency: 'usd' }));
    const second = normalizeStripeEvent(event('charge.refunded', { id: 'ch_2', amount_refunded: 1200, currency: 'usd' }));
    expect(first?.external_id).toBe(second?.external_id);
    expect(second?.amount_cents).toBe(-1200);
  });

  it('skips a charge with nothing refunded', () => {
    expect(normalizeStripeEvent(event('charge.refunded', { id: 'ch_3', amount_refunded: 0, currency: 'usd' }))).toBeNull();
  });
});

describe('disputes', () => {
  it('records an opened dispute as a negative amount', () => {
    const r = normalizeStripeEvent(event('charge.dispute.created', { id: 'dp_1', amount: 2900, currency: 'usd' }));
    expect(r).toMatchObject({ kind: 'dispute', amount_cents: -2900, external_id: 'dispute_dp_1' });
  });

  it('reverses a won dispute back to zero under the same id', () => {
    const opened = normalizeStripeEvent(event('charge.dispute.created', { id: 'dp_2', amount: 2900, currency: 'usd' }));
    const won = normalizeStripeEvent(event('charge.dispute.closed', { id: 'dp_2', amount: 2900, currency: 'usd', status: 'won' }));
    expect(won?.amount_cents).toBe(0);
    // Same external_id means the upsert overwrites the -2900 row.
    expect(won?.external_id).toBe(opened?.external_id);
  });

  it('keeps a lost dispute negative', () => {
    const lost = normalizeStripeEvent(event('charge.dispute.closed', { id: 'dp_3', amount: 2900, currency: 'usd', status: 'lost' }));
    expect(lost?.amount_cents).toBe(-2900);
  });
});

describe('resolveProject', () => {
  const mappings: MappingRow[] = [
    { project_id: 'by-account', match_type: 'account', match_value: 'acct_1' },
    { project_id: 'by-product', match_type: 'product', match_value: 'prod_1' },
    { project_id: 'by-price', match_type: 'price', match_value: 'price_1' },
    { project_id: 'catch-all', match_type: 'account', match_value: null },
  ];

  it('prefers price over product over account', () => {
    expect(resolveProject({ account: 'acct_1', product: 'prod_1', price: 'price_1' }, mappings)).toBe('by-price');
    expect(resolveProject({ account: 'acct_1', product: 'prod_1' }, mappings)).toBe('by-product');
    expect(resolveProject({ account: 'acct_1' }, mappings)).toBe('by-account');
  });

  it('falls back to the catch-all', () => {
    expect(resolveProject({ account: 'acct_unknown' }, mappings)).toBe('catch-all');
  });

  it('returns null rather than guessing when nothing matches', () => {
    // Recording money against an arbitrary project is worse than dropping it.
    expect(resolveProject({ account: 'acct_9' }, [
      { project_id: 'p', match_type: 'account', match_value: 'acct_1' },
    ])).toBeNull();
  });
});

describe('withBaseAmount', () => {
  it('converts to the display currency and keeps the native one', () => {
    const r = normalizeStripeEvent(event('payment_intent.succeeded', { id: 'pi_9', amount_received: 1000, currency: 'eur', created: at }))!;
    const withBase = withBaseAmount(r, 'USD', { EUR: 1.1 });
    expect(withBase.amount_cents).toBe(1000);
    expect(withBase.currency).toBe('EUR');
    expect(withBase.amount_base_cents).toBe(1100);
    expect(withBase.base_currency).toBe('USD');
  });

  it('keeps refunds negative through conversion', () => {
    const r = normalizeStripeEvent(event('charge.refunded', { id: 'ch_9', amount_refunded: 1000, currency: 'eur' }))!;
    expect(withBaseAmount(r, 'USD', { EUR: 1.1 }).amount_base_cents).toBe(-1100);
  });
});
