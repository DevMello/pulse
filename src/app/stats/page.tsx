import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { StatsView } from './stats-view';

/**
 * /stats — the canonical public page, 30 days.
 *
 * No searchParams, so Next can statically generate it and serve every visitor
 * from the CDN. Other ranges live at /stats/[days], which is also static.
 */
export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Stats',
  description: 'Live traffic and revenue, published openly.',
  robots: { index: true, follow: true },
};

export default function StatsPage() {
  const showLanding = process.env.NEXT_PUBLIC_PULSE_SHOW_LANDING !== 'false';
  const showLive = process.env.NEXT_PUBLIC_PULSE_SHOW_LIVE !== 'false';
  if (!showLanding || !showLive) redirect('/app');

  return <StatsView days={30} />;
}
