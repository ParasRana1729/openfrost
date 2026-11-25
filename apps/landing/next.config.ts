import type { NextConfig } from 'next';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig: NextConfig = {
  output: 'export',
  ...(basePath ? { basePath } : {}),
  experimental: {
    agentUpgrade: 'security',
  },
};

export default nextConfig;
