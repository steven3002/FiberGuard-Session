/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the gateway serves `out/` at /approve/* (same origin, no CORS).
  output: "export",
  images: { unoptimized: true },
  // The approval screen is a single client-rendered page; the session request id
  // is read from the path at runtime (the gateway serves this page for
  // /approve/:id), so no per-id route needs to exist at export time.
};

export default nextConfig;
