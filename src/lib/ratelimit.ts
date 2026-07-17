/**
 * Rate limiting without Redis.
 *
 * Section 13 commits to Vercel + Supabase and nothing else, which rules out a
 * shared counter. So this is an in-memory token bucket, per edge isolate.
 *
 * Be honest about what that means: each isolate has its own bucket, so the
 * effective global limit is (limit x number of live isolates). It is a spike
 * damper, not a quota. That is the right trade here — the job is to stop one
 * script hammering the collector from burning the free tier, and for that a
 * per-isolate cap works, because a single abusive client sticks to a small
 * number of edge nodes. A precise global limit would mean a round trip to
 * shared state on every event, which would cost more than the abuse does.
 *
 * The domain allow-list, not this, is what makes spoofed ingestion pointless
 * (Section 11).
 */

interface Bucket {
  tokens: number;
  updated: number;
}

const buckets = new Map<string, Bucket>();

/** Cap the map so a flood of distinct keys can't grow it without bound. */
const MAX_KEYS = 10_000;

export interface RateLimitOptions {
  /** Sustained events per second. */
  ratePerSecond: number;
  /** Burst allowance above the sustained rate. */
  burst: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the next token, for Retry-After. */
  retryAfter: number;
}

export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();

  if (buckets.size > MAX_KEYS) {
    // Cheaper than LRU bookkeeping on every request, and an isolate rarely gets
    // near this. Dropping the table means everyone briefly gets a fresh burst,
    // which is a far better failure than unbounded memory in a function.
    buckets.clear();
  }

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: opts.burst, updated: now };
    buckets.set(key, bucket);
  }

  const elapsed = (now - bucket.updated) / 1000;
  bucket.tokens = Math.min(opts.burst, bucket.tokens + elapsed * opts.ratePerSecond);
  bucket.updated = now;

  if (bucket.tokens < 1) {
    return { ok: false, retryAfter: Math.ceil((1 - bucket.tokens) / opts.ratePerSecond) };
  }

  bucket.tokens -= 1;
  return { ok: true, retryAfter: 0 };
}

/** Exposed for tests, which must not inherit state from each other. */
export function _resetRateLimits(): void {
  buckets.clear();
}
