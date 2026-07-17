import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * Data export (Section 9.4).
 *
 * Runs under the owner's session, so RLS decides what's exportable — an
 * unauthenticated request gets nothing, and there is no way to name someone
 * else's project into this.
 *
 * Streams NDJSON/CSV in pages rather than buffering: a year of raw events can
 * be hundreds of MB, and building that string in a function's memory is how you
 * turn "export my data" into an OOM.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE = 1000;
const MAX_ROWS = 500_000;

type Kind = 'events' | 'rollups' | 'revenue';

const TABLES: Record<Kind, { table: string; order: string; columns: string }> = {
  events: {
    table: 'events',
    order: 'ts',
    columns: 'ts, name, is_pageview, path, referrer_host, referrer_group, utm_source, utm_medium, utm_campaign, utm_term, utm_content, device, browser, os, country, region, screen_bucket, visitor_hash, revenue_amount, revenue_currency, props',
  },
  rollups: {
    table: 'rollups',
    order: 'bucket',
    columns: 'period, bucket, pageviews, visitors, sessions, bounces, duration_sec, events, revenue_cents',
  },
  revenue: {
    table: 'revenue_records',
    order: 'occurred_at',
    columns: 'occurred_at, source, kind, amount_cents, currency, amount_base_cents, base_currency, external_id, label, note',
  },
};

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);

  const kind = (url.searchParams.get('kind') ?? 'events') as Kind;
  const format = url.searchParams.get('format') === 'json' ? 'json' : 'csv';

  const spec = TABLES[kind];
  if (!spec) return NextResponse.json({ error: 'unknown export kind' }, { status: 400 });

  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const { data: project } = await db.from('projects').select('id, name').eq('slug', slug).maybeSingle();
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const encoder = new TextEncoder();
  let wroteHeader = false;
  let first = true;

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        if (format === 'json' && first) controller.enqueue(encoder.encode('['));

        for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
          const { data, error } = await db
            .from(spec.table)
            .select(spec.columns)
            .eq('project_id', project.id)
            .order(spec.order, { ascending: true })
            .range(offset, offset + PAGE - 1);

          if (error) throw new Error(error.message);
          if (!data || data.length === 0) break;

          for (const row of data) {
            if (format === 'json') {
              controller.enqueue(encoder.encode((first ? '' : ',\n') + JSON.stringify(row)));
              first = false;
            } else {
              if (!wroteHeader) {
                controller.enqueue(encoder.encode(Object.keys(row).join(',') + '\n'));
                wroteHeader = true;
              }
              controller.enqueue(encoder.encode(toCsvRow(Object.values(row)) + '\n'));
            }
          }

          if (data.length < PAGE) break;
        }

        if (format === 'json') controller.enqueue(encoder.encode(']'));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(stream, {
    headers: {
      'Content-Type': format === 'json' ? 'application/json' : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="pulse-${slug}-${kind}-${stamp}.${format}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * RFC 4180 quoting.
 *
 * The leading-character check defends against CSV injection: a value starting
 * with =, +, -, or @ is executed as a formula when the file is opened in Excel
 * or Sheets. A path or UTM value is attacker-controlled — someone can visit
 * `/=cmd|'/c calc'!A1` on your site — so exporting it raw turns your own
 * analytics into a payload delivery mechanism aimed at yourself.
 */
function toCsvRow(values: unknown[]): string {
  return values.map(toCsvCell).join(',');
}

function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);

  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;

  return s;
}
