import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        // The tracker is a static, immutable asset. Long edge cache, revalidate
        // in the background so a redeploy propagates without a stampede.
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
      // Friendly aliases so owners can serve the snippet from a path that
      // ad-blockers key on less aggressively than "/analytics.js".
      { source: '/script.js', destination: '/px.js' },
    ];
  },
};

export default nextConfig;
