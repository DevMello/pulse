import type { Metadata } from 'next';
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
  return <StatsView days={30} />;
}
