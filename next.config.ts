import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Native database drivers and the job runner stay outside the bundler.
  serverExternalPackages: ["pg", "pg-boss", "@prisma/adapter-pg", "@prisma/client"],
  // No remote images are used; the official ATB logo is served from /public/brand unchanged.
  images: { unoptimized: true },
  // Dev-mode only: let the GitHub Codespaces forwarded URL load dev assets (production mode is unaffected).
  allowedDevOrigins: ["*.app.github.dev", "*.githubpreview.dev"],
};

export default nextConfig;
