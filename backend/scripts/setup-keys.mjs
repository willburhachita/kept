#!/usr/bin/env node
/**
 * One-time setup of the secrets this backend needs, set directly on your
 * Convex deployment (never written to disk, never printed):
 *   JWT_PRIVATE_KEY, JWKS   Convex Auth session signing (RS256)
 *   RECEIPT_SIGNING_KEY     Ed25519 seed that signs every receipt and checkpoint
 *   SITE_URL                frontend URL (PayPal return URLs, invite links)
 *   PAYMENT_RAIL            "sim" until PayPal sandbox keys are set, then "paypal"
 *   FEE_BPS                 platform fee in basis points (default 250 = 2.5%)
 *
 *   node scripts/setup-keys.mjs [--prod] [--print] [--force] [--site-url URL] [--rail sim|paypal] [--fee-bps N]
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const cwd = join(dirname(fileURLToPath(import.meta.url)), "..");
const prod = flag("prod") ? ["--prod"] : [];

// Run the Convex CLI through Node directly (no shell), so values with quotes/spaces pass verbatim on every OS.
const require = createRequire(join(cwd, "package.json"));
const convexPkgPath = require.resolve("convex/package.json");
const convexPkg = JSON.parse(readFileSync(convexPkgPath, "utf8"));
const convexBin = join(dirname(convexPkgPath), typeof convexPkg.bin === "string" ? convexPkg.bin : convexPkg.bin.convex);

function convex(...rest) {
  return spawnSync(process.execPath, [convexBin, ...rest, ...prod], { cwd, encoding: "utf8" });
}

function exists(name) {
  const r = convex("env", "get", name);
  return r.status === 0 && r.stdout.trim().length > 0;
}

function set(name, value, secret = true) {
  if (flag("print")) {
    console.log(`npx convex env set ${name} -- ${secret ? "<redacted>" : value} ${prod.join(" ")}`);
    return;
  }
  if (!flag("force") && exists(name)) {
    console.log(`= ${name} already set (use --force to replace)`);
    return;
  }
  const r = convex("env", "set", name, "--", value);
  if (r.status !== 0) {
    console.error(`! failed to set ${name}: ${(r.stderr || r.stdout).split("\n")[0]}`);
    process.exitCode = 1;
  } else console.log(`+ ${name} set`);
}

// Convex Auth (RS256)
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString().trimEnd().replace(/\n/g, " ");
const jwks = JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...publicKey.export({ format: "jwk" }) }] });

// Receipt key (Ed25519 seed) and its public half
const seed = randomBytes(32);
const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
const pub = createPublicKey(createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" })).export({ format: "der", type: "spki" }).subarray(-32);

set("JWT_PRIVATE_KEY", pem);
set("JWKS", jwks);
set("RECEIPT_SIGNING_KEY", seed.toString("hex"));
set("SITE_URL", opt("site-url", "http://localhost:5173"), false);
set("PAYMENT_RAIL", opt("rail", "sim"), false);
set("FEE_BPS", String(Number(opt("fee-bps", "250"))), false);

console.log(`\nReceipt public key (publish it; also served at /.well-known/kept-keys.json): ${pub.toString("hex")}`);
console.log("Next: set PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID and ANTHROPIC_API_KEY with `npx convex env set`, then PAYMENT_RAIL=paypal.");
