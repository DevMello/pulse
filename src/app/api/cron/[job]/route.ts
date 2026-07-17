import { NextResponse } from 'next/server';
import { supabaseAdmin, ingestConfigured } from '@/lib/supabase/admin';

/**
 * Vercel Cron entry point (Section 12).
 *
 * The default is Supabase pg_cron — it's already scheduled by the migrations, so
 * a fork works with zero Vercel configuration. This exists for people who'd
 * rather see their jobs in the Vercel dashboard, or whose Postgres doesn't have
 * pg_cron.
 *
 * Run one or the other. Both is harmless (every job is idempotent) but wasteful.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const JOBS: Record<string, string> = {
  rollup: 'pulse_rollup_recent',
  prune: 'pulse_prune',
  goals: 'pulse_check_goals',
};

export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const { job } = await params;

  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!ingestConfigured()) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const fn = JOBS[job];
  if (!fn) return NextResponse.json({ error: `unknown job: ${job}` }, { status: 404 });

  const started = Date.now();
  const { data, error } = await supabaseAdmin().rpc(fn);

  if (error) {
    console.error(`pulse cron ${job} failed:`, error.message);
    // 500 so a failing rollup shows up as a failed cron run in Vercel rather
    // than a green checkmark hiding stale dashboards.
    return NextResponse.json({ job, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ job, ok: true, ms: Date.now() - started, result: data ?? null });
}

/**
 * Vercel Cron sends a bearer token equal to CRON_SECRET. Without this check the
 * endpoint is a public button for running the most expensive query in the
 * system, as often as anyone likes.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;

  // Fail closed. An unset secret with an open endpoint would be a worse default
  // than the jobs simply not running — and pg_cron is already handling them.
  if (!secret) return false;

  return req.headers.get('authorization') === `Bearer ${secret}`;
}
