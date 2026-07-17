import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StatsView } from '../stats-view';

/**
 * /stats/[days] — alternate ranges as their own cacheable URLs.
 *
 * generateStaticParams prebuilds the ranges the UI links to, so switching range
 * is a CDN hit rather than a query. dynamicParams = false means any other value
 * 404s instead of becoming an uncached, on-demand render — otherwise
 * /stats/999999 would be a free way to make the database work.
 */
export const revalidate = 300;
export const dynamicParams = false;

const RANGES = [7, 30, 90, 365] as const;

export function generateStaticParams() {
  return RANGES.map((days) => ({ days: String(days) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ days: string }>;
}): Promise<Metadata> {
  const { days } = await params;
  return {
    title: `Stats · last ${days} days`,
    description: 'Live traffic and revenue, published openly.',
    robots: { index: true, follow: true },
  };
}

export default async function StatsRangePage({ params }: { params: Promise<{ days: string }> }) {
  const { days } = await params;
  const parsed = Number(days);

  if (!RANGES.includes(parsed as (typeof RANGES)[number])) notFound();

  return <StatsView days={parsed} />;
}
