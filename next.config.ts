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

      /**
       * OAuth discovery lives at fixed /.well-known/ paths (RFC 8414, RFC 9728)
       * that MCP clients probe without being told. A Next route segment cannot
       * start with a dot, so the handlers live under /api/oauth and are mapped
       * here.
       *
       * The suffixed forms matter: RFC 9728 says a resource at /api/mcp
       * publishes its metadata at /.well-known/oauth-protected-resource/api/mcp,
       * and clients differ on whether they try that or the bare path first.
       * Serving both is a few lines and removes an entire category of
       * "connector won't connect" with no diagnostic.
       */
      { source: '/.well-known/oauth-authorization-server', destination: '/api/oauth/authorization-server' },
      { source: '/.well-known/oauth-authorization-server/:path*', destination: '/api/oauth/authorization-server' },
      { source: '/.well-known/oauth-protected-resource', destination: '/api/oauth/protected-resource' },
      { source: '/.well-known/oauth-protected-resource/:path*', destination: '/api/oauth/protected-resource' },
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
