import { defineConfig } from "vitest/config";

// Offline test harness: node environment, no setup files, no network usage.
// CI runs `pnpm test` as a zero-network gate between typecheck and build.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
