import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  poweredByHeader: false,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
