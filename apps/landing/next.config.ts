import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  experimental: {
    agentUpgrade: 'security',
  },
};

export default nextConfig;
