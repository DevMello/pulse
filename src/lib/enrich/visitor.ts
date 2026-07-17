/**
 * The privacy-preserving visitor hash (Section 4.4).
 *
 * This is the mechanism the whole "no cookies, no consent banner" claim rests
 * on, so it's worth being precise about what it does and does not give you.
 *
 * The hash is:
 *
 *     SHA-256( daily_salt + project_id + ip + user_agent )
 *
 * Every input except the salt is already present in an ordinary HTTP request;
 * none of them is stored. The IP is used to compute this and to look up a
 * country, then discarded — it never reaches the database.
 *
 * What each ingredient is for:
 *
 *   daily_salt   random, regenerated every UTC day, destroyed after 48h. Once
 *                the salt is gone the hash cannot be recomputed or reversed by
 *                anyone, including whoever owns the database. This is what
 *                makes cross-day tracking impossible rather than merely
 *                discouraged, and it's why the salt is destroyed on a schedule
 *                instead of kept "just in case".
 *   project_id   stops the same visitor correlating across two sites hosted on
 *                one Pulse instance. Without it, a shared salt would make
 *                cross-site tracking trivial — the exact thing being avoided.
 *   ip + ua      the coarse signals that distinguish one visitor from another
 *                within a single day.
 *
 * The honest limits, which the methodology note states publicly:
 *
 *   - Two people behind one NAT on identical devices count once.
 *   - One person on phone and laptop counts twice.
 *   - A visitor's count resets at UTC midnight.
 *
 * These are real inaccuracies and they are the point: a number that can't be
 * tied to a person is worth more than a number that can.
 */

/**
 * Hex-encoded SHA-256, via WebCrypto so this runs unchanged on the edge
 * runtime, where node:crypto isn't available.
 */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface VisitorHashInput {
  salt: string;
  projectId: string;
  ip: string | null | undefined;
  userAgent: string | null | undefined;
}

export async function computeVisitorHash(input: VisitorHashInput): Promise<string> {
  const { salt, projectId, ip, userAgent } = input;

  // \x1f (unit separator) can't occur in any of these values, so the fields
  // can't be shifted across the boundary to collide two different visitors.
  const material = [salt, projectId, ip ?? '', userAgent ?? ''].join('\x1f');
  const full = await sha256Hex(material);

  // 128 bits is far past what's needed to avoid collisions at any plausible
  // per-project daily volume, and halves the size of the busiest column in the
  // busiest table.
  return full.slice(0, 32);
}

/**
 * Best-effort client IP.
 *
 * Order matters: Vercel sets x-real-ip itself and it cannot be spoofed by the
 * client, whereas x-forwarded-for is client-appendable — the leftmost entry is
 * whatever the caller claimed. Trusting XFF first would let anyone forge a
 * distinct "visitor" per request and inflate the unique count.
 */
export function clientIp(headers: Headers): string | null {
  const real = headers.get('x-real-ip');
  if (real) return real.trim();

  const cf = headers.get('cf-connecting-ip');
  if (cf) return cf.trim();

  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }

  return null;
}
