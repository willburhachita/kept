import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "core",
          include: ["packages/*/test/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        // Pure browser-side logic (no React): tamper checks, policy backtests.
        resolve: { alias: { "@": new URL("./web", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") } },
        test: {
          name: "web",
          include: ["web/tests/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "backend",
          include: ["backend/tests/**/*.test.ts"],
          environment: "edge-runtime",
          // Full lifecycles (verify, fund, capture, pay out) take a few seconds under parallel load.
          testTimeout: 30_000,
          server: { deps: { inline: ["convex-test"] } },
        },
      },
    ],
  },
});
