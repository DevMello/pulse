import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/px.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
      {
        source: '/api/event',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
          { key: 'Access-Control-Max-Age', value: '86400' },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      { source: '/script.js', destination: '/px.js' },
    ];
  },
  async redirects() {
    const showLanding = process.env.NEXT_PUBLIC_PULSE_SHOW_LANDING !== 'false';
    const showLive = process.env.NEXT_PUBLIC_PULSE_SHOW_LIVE !== 'false';
    const showPublic = showLanding && showLive;

    const rules = [
      { source: '/app/p/:slug/traffic', destination: '/app/p/:slug', permanent: false },
    ];

    if (!showPublic) {
      rules.push(
        { source: '/', destination: '/app', permanent: false },
        { source: '/stats', destination: '/app', permanent: false },
        { source: '/stats/:path*', destination: '/app', permanent: false },
      );
    }

    return rules;
  },
};

export default nextConfig;
