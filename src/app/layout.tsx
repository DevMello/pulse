import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Pulse',
    template: '%s · Pulse',
  },
  description: 'Privacy-first, self-hosted analytics with revenue tracking and a public stats page.',
  robots: {
    // The dashboard is private and the stats page opts itself in per route.
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
