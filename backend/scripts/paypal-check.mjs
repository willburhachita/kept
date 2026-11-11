#!/usr/bin/env node
/**
 * Prints the PayPal setup check (convex/paypalCheck.ts) as plain lines.
 *
 *   npm run paypal:check            against your dev deployment
 *   npm run paypal:check -- --prod  against production
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cwd = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(cwd, "package.json"));
const pkgPath = require.resolve("convex/package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const bin = join(dirname(pkgPath), typeof pkg.bin === "string" ? pkg.bin : pkg.bin.convex);
const r = spawnSync(process.execPath, [bin, "run", "paypalCheck:run", ...process.argv.slice(2)], { cwd, encoding: "utf8" });
let lines;
try {
  lines = JSON.parse(r.stdout);
} catch {
  process.stderr.write(r.stderr || r.stdout || "convex run failed\n");
  console.error("\nCouldn't run the check. Is the backend set up? (cd backend && npx convex dev)");
  process.exit(1);
}
console.log("\nKept · PayPal setup check\n");
for (const l of lines) console.log(l ? `  ${l}` : "");
console.log("");
process.exit(lines.some((l) => l.startsWith("✗")) ? 1 : 0);
