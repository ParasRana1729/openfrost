import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@openfrost/domain", "@openfrost/ui"],
  reactStrictMode: true,
};

export default nextConfig;
