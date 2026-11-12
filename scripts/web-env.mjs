#!/usr/bin/env node
/**
 * Writes web/.env.local from backend/.env.local (which `npx convex dev` creates), so the web app talks
 * to the same Convex deployment. Run it after `npx convex dev` has set up the backend.
 *
 *   npm run setup:web-env            keeps an existing web/.env.local
 *   npm run setup:web-env -- --force overwrites it
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const from = new URL("backend/.env.local", root), to = new URL("web/.env.local", root);
if (!existsSync(from)) {
  console.error("backend/.env.local not found. Run `cd backend && npx convex dev` first; it creates that file.");
  process.exit(1);
}
const vars = Object.fromEntries(
  readFileSync(from, "utf8").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);
const url = vars.CONVEX_URL ?? vars.VITE_CONVEX_URL;
if (!url) {
  console.error("backend/.env.local has no CONVEX_URL. Run `cd backend && npx convex dev` again.");
  process.exit(1);
}
const site = vars.CONVEX_SITE_URL ?? url.replace(/\.convex\.cloud$/, ".convex.site");
if (existsSync(to) && !process.argv.includes("--force")) {
  console.log("web/.env.local already exists; leaving it. Use --force to overwrite.");
  process.exit(0);
}
writeFileSync(to, `# Written by npm run setup:web-env from backend/.env.local\nNEXT_PUBLIC_CONVEX_URL=${url}\nNEXT_PUBLIC_CONVEX_SITE_URL=${site}\nNEXT_PUBLIC_SITE_URL=http://localhost:3000\n`);
console.log(`web/.env.local written: Convex ${url}`);
