import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Native database drivers and the job runner stay outside the bundler.
  serverExternalPackages: ["pg", "pg-boss", "@prisma/adapter-pg", "@prisma/client"],
  // No remote images are used; the official ATB logo is served from /public/brand unchanged.
  images: { unoptimized: true },
};

export default nextConfig;
