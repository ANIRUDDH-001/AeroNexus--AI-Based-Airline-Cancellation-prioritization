import type { NextConfig } from "next";

// Local development proxies /api -> the FastAPI engine so the browser never needs CORS.
// Production (Vercel) sets NEXT_PUBLIC_API_URL and calls the engine directly.
const API_TARGET = process.env.API_PROXY_TARGET || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    if (process.env.NEXT_PUBLIC_API_URL) return [];
    return [{ source: "/api/:path*", destination: `${API_TARGET}/:path*` }];
  },
};

export default nextConfig;
