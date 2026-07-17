import type { Metadata } from 'next';
import { Space_Grotesk, Inter } from 'next/font/google';
import './globals.css';

/**
 * next/font fetches at build time and self-hosts the result, so neither font
 * costs a runtime request to a third party. That matters more than usual here:
 * the public stats page's whole promise is that it loads instantly and leaks
 * nothing, and a Google Fonts <link> would break both halves of that.
 */
const display = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-pulse-display',
  display: 'swap',
});

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-pulse-sans',
  display: 'swap',
});

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

/**
 * Runs before first paint, inlined so it can't lose the race and flash the
 * wrong theme. Resolves to a concrete 'light' | 'dark' (stored choice first,
 * OS preference otherwise) so the stylesheet needs exactly one dark selector
 * instead of a media query and an override that must be kept identical.
 * No JS ⇒ no data-theme ⇒ the light defaults apply.
 */
const themeInit = `try{var t=localStorage.getItem('pulse-theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the script above mutates <html> before React
    // hydrates, and that one attribute is expected to differ.
    <html lang="en" className={`${display.variable} ${sans.variable}`} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
      </body>
    </html>
  );
}
