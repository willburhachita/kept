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
          exclude: ["backend/tests/paypal/**"],
          environment: "edge-runtime",
          // Full lifecycles (verify, fund, capture, pay out) take a few seconds under parallel load.
          testTimeout: 30_000,
          server: { deps: { inline: ["convex-test"] } },
        },
      },
      {
        // Kept's real PayPal code path against a stand-in that validates every call against PayPal's
        // published OpenAPI specs. Node, not edge-runtime: the schema validator compiles code.
        test: {
          name: "paypal",
          include: ["backend/tests/paypal/**/*.test.ts"],
          environment: "node",
          testTimeout: 60_000,
          server: { deps: { inline: ["convex-test"] } },
        },
      },
    ],
  },
});
