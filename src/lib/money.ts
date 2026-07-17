/**
 * Money handling.
 *
 * Two rules, both non-negotiable:
 *
 *   1. Money is integer minor units. Never a float. 0.1 + 0.2 !== 0.3 and a
 *      public revenue figure that is subtly wrong is worse than none.
 *   2. The native currency is always stored as charged. Conversion is only ever
 *      for a combined display total, and it is lossy — rates are static and
 *      dated. Nothing is ever converted in place.
 */

/**
 * Currencies with no minor unit. Stripe reports these as whole units while
 * every other currency is in cents, so treating a ¥1000 charge as 1000 cents
 * would report ¥10 and treating it as x100 would report ¥100,000. Both are
 * wrong in a way nobody notices until the public page is embarrassing.
 */
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG',
  'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/** Currencies with three minor digits, billed in units of 1000 by Stripe. */
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

export function currencyDecimals(currency: string): number {
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

/**
 * A major-unit amount (29.99) -> minor units (2999), respecting the currency's
 * actual precision.
 */
export function toMinorUnits(amount: number, currency: string): number {
  const factor = Math.pow(10, currencyDecimals(currency));
  return Math.round(amount * factor);
}

export function fromMinorUnits(minor: number, currency: string): number {
  return minor / Math.pow(10, currencyDecimals(currency));
}

/**
 * FX rates, expressed as "1 unit of KEY = N units of the display currency".
 * Read from PULSE_FX_RATES, e.g. {"EUR":1.09,"GBP":1.27}.
 *
 * Static on purpose. A live FX API would be another dependency, another key,
 * another failure mode, and another thing that can't run on the free tier —
 * for a display-only total on a hobbyist's stats page. Unknown currencies pass
 * through at 1:1 rather than silently vanishing from the total.
 */
export function parseFxRates(raw: string | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const rate = Number(v);
      if (Number.isFinite(rate) && rate > 0) out[k.toUpperCase()] = rate;
    }
    return out;
  } catch {
    return {};
  }
}

export interface ConvertInput {
  amountMinor: number;
  from: string;
  to: string;
  rates: Record<string, number>;
}

/**
 * Convert between currencies at the display level. Goes through major units
 * because the two currencies may have different precision — 1000 JPY minor
 * units is ¥1000, not ¥10.
 */
export function convertMinor({ amountMinor, from, to, rates }: ConvertInput): number {
  const src = from.toUpperCase();
  const dst = to.toUpperCase();
  if (src === dst) return amountMinor;

  const rate = rates[src];
  if (!rate) {
    // No rate configured. Passing the number through unconverted is wrong, but
    // it is visibly wrong and keeps the money in the total; dropping it would
    // be invisibly wrong. The dashboard flags unconverted currencies.
    return amountMinor;
  }

  const major = fromMinorUnits(amountMinor, src);
  return toMinorUnits(major * rate, dst);
}

export function displayCurrency(): string {
  return (process.env.PULSE_DISPLAY_CURRENCY || 'USD').toUpperCase();
}

/** Format minor units for humans, using the viewer's locale conventions. */
export function formatMoney(minor: number, currency: string, locale?: string): string {
  const decimals = currencyDecimals(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(fromMinorUnits(minor, currency));
}

/** Compact form for headline tiles: $12.5k. */
export function formatMoneyCompact(minor: number, currency: string, locale?: string): string {
  const major = fromMinorUnits(minor, currency);
  if (Math.abs(major) < 10_000) return formatMoney(minor, currency, locale);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(major);
}
