import { supabasePublic } from '@/lib/supabase/server';

/**
 * Embeddable live-visitor badge (Section 10.3).
 *
 * An SVG rather than an iframe or a script, so it works in a GitHub README,
 * inside markdown, and anywhere else that allows an <img> — which is the whole
 * point of a badge.
 *
 * Runs as anon, so pulse_public_live() enforces the owner's toggles: an
 * unpublished project's badge reports zero rather than leaking a real count.
 */
export const runtime = 'edge';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const label = (url.searchParams.get('label') ?? 'live').slice(0, 20);

  let online = 0;
  try {
    const { data } = await supabasePublic().rpc('pulse_public_live', { p_slug: slug });
    online = typeof data === 'number' ? data : 0;
  } catch {
    // A badge that renders "0" is strictly better than a broken-image icon on
    // somebody's homepage.
  }

  const value = String(online);

  // Rough advance width for the 11px sans stack. Measuring properly would need
  // font metrics we don't have at the edge; over-estimating slightly is safe
  // because the text is centered and the badge just looks a touch roomy.
  const labelWidth = Math.ceil(label.length * 6.2) + 10;
  const valueWidth = Math.ceil(value.length * 7) + 16;
  const total = labelWidth + valueWidth;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${escapeXml(label)}: ${value}">
  <title>${escapeXml(label)}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".7"/>
    <stop offset=".1" stop-color="#aaa" stop-opacity=".1"/>
    <stop offset=".9" stop-color="#000" stop-opacity=".3"/>
    <stop offset="1" stop-color="#000" stop-opacity=".5"/>
  </linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#24292f"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="#22c55e"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text>
    <text x="${labelWidth / 2}" y="14">${escapeXml(label)}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${value}</text>
  </g>
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // 30s: fresh enough to feel live, long enough that a popular README can't
      // become a load source. GitHub proxies images anyway and will cache harder.
      'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=120',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * The label comes from a query string, so it is attacker-controlled and gets
 * interpolated into markup. Without escaping, `?label=<script>` on someone's
 * page would be a stored XSS delivered by our own domain.
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
