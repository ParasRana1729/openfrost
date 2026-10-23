import type { NextConfig } from 'next';

const apiOrigin = process.env.OPENFROST_API_ORIGIN ?? 'http://127.0.0.1:8787';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(apiOrigin)) {
  throw new Error(
    `OPENFROST_API_ORIGIN must be a loopback origin (got "${apiOrigin}"); ` +
      'the web app only proxies to the local API service.',
  );
}

const nextConfig: NextConfig = {
  // The browser talks to this origin only; API calls are proxied to the
  // local service so the session cookie stays first-party on any loopback
  // host (127.0.0.1:3000 and localhost:3000 both work), and the SSE stream
  // is same-origin.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
