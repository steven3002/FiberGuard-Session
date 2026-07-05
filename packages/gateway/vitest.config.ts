import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // First Fastify instantiation in a run is slow on WSL-mounted Windows
    // filesystems; the default 5s timeout produces false failures.
    testTimeout: 30_000,
  },
});
