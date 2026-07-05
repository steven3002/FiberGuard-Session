/** @type {import('next').NextConfig} */
const nextConfig = {
  // Runs as its own dev/prod server on :3001 and calls the gateway (:8787)
  // cross-origin via the SDK — a natural external-app integration.
  transpilePackages: ["@fiberguard/session"],
};

export default nextConfig;
