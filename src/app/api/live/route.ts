import { NextResponse } from 'next/server';
import { supabasePublic } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/ratelimit';
import { clientIp } from '@/lib/enrich/visitor';

/**
 * Live visitor count for the public page.
 *
 * Runs as anon, so pulse_public_live() is the gate: it returns 0 unless the
 * project is published *and* has the live count enabled. There is no way to
 * read a number the owner didn't publish.
 *
 * Cached for 10s at the edge. "Live" doesn't need to be sub-second, and this is
 * the only public endpoint that touches raw events — a 10s cache means a hot
 * page costs at most 6 queries a minute no matter how many people are watching.
 */
export const runtime = 'edge';

export async function GET(req: Request): Promise<NextResponse> {
  const ip = clientIp(req.headers);
  const limit = rateLimit(`live:${ip ?? 'unknown'}`, { ratePerSecond: 1, burst: 10 });
  if (!limit.ok) {
    return NextResponse.json({ online: 0 }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });
  }

  const slug = new URL(req.url).searchParams.get('slug');

  try {
    const db = supabasePublic();
    const { data, error } = await db.rpc('pulse_public_live', { p_slug: slug || null });
    if (error) throw new Error(error.message);

    return NextResponse.json(
      { online: data ?? 0 },
      { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } }
    );
  } catch {
    // A failure here must not break the page it's embedded in. Zero renders as
    // no badge at all.
    return NextResponse.json({ online: 0 });
  }
}
