import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Financial logos / news images are loaded from third-party CDNs in production.
  // In dev we use local placeholders, so remote patterns stay permissive but explicit.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
