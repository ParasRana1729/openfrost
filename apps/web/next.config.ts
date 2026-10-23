import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The API service is a separate local process; the browser talks to it
  // directly on loopback with credentials (CORS allowlisted in apps/api).
};

export default nextConfig;
