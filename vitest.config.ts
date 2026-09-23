import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Offline test harness: jsdom for component tests, no network usage anywhere.
// CI runs `pnpm test` as a zero-network gate between typecheck and build.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // The Extreme e2e streams a multi-GB verbatim log through short-lived
    // multi-MB strings; without a bounded old-space V8 balloons past the
    // machine's RAM before a major GC ever runs (OS OOM-kills the worker).
    // Capping worker heaps forces GC to reclaim transients instead.
    execArgv: ["--max-old-space-size=2048"],
  },
});
