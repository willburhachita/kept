#!/usr/bin/env node
/**
 * Rebrand the repo from the placeholder "Kept" to a new name.
 *   node scripts/rename.mjs <NewName> [--slug <slug>] [--dry-run]
 * Replaces package scopes (@kept/ -> @slug/), brand identifiers and the
 * capitalized brand word in docs. Leaves the English word "kept" in prose
 * alone. Re-run `npm install` afterwards.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
if (!name || !/^[A-Za-z][A-Za-z0-9]{1,30}$/.test(name)) {
  console.error("Usage: node scripts/rename.mjs <NewName> [--slug <slug>] [--dry-run]");
  process.exit(2);
}
const si = args.indexOf("--slug");
const slug = si >= 0 ? args[si + 1] : name.toLowerCase();
const dry = args.includes("--dry-run");
if (!/^[a-z][a-z0-9-]{1,30}$/.test(slug)) {
  console.error("Slug must be lowercase letters, digits or dashes.");
  process.exit(2);
}

const SKIP_DIRS = new Set(["node_modules", "dist", "_generated", ".git", ".convex"]);
const EXT = /\.(ts|tsx|js|mjs|cjs|json|md)$/;

/** [pattern, replacement, appliesTo] */
const RULES = [
  [/@kept\//g, `@${slug}/`, () => true],
  [/\bkept-monorepo\b/g, `${slug}-monorepo`, () => true],
  [/\bkept-mandate\b/g, `${slug}-mandate`, () => true],
  [/\bkept-proof-pack\b/g, `${slug}-proof-pack`, () => true],
  [/\bkept-keys\.json\b/g, `${slug}-keys.json`, () => true],
  [/\bkept-mcp\b/g, `${slug}-mcp`, () => true],
  [/name: "Kept"/g, `name: "${name}"`, (f) => f.endsWith("brand.ts")],
  [/slug: "kept"/g, `slug: "${slug}"`, (f) => f.endsWith("brand.ts")],
  [/"Every promise, kept\."/g, `"${name}: every promise, kept."`, (f) => f.endsWith("brand.ts")],
  [/\?\? "Kept"/g, `?? "${name}"`, (f) => f.endsWith("env.ts")],
  [/\bKEPT_(API_URL|MANDATE_TOKEN|API_KEY)\b/g, `${slug.toUpperCase().replace(/-/g, "_")}_$1`, () => true],
  [/\bKept\b/g, name, (f) => f.endsWith(".md")],
  [/\bcreateKeptServer\b/g, `create${name}Server`, () => true],
  [/\bKeptApiError\b/g, `${name}ApiError`, () => true],
  [/\bKeptAgent\b/g, `${name}Agent`, () => true],
  [/\bclass Kept\b/g, `class ${name}`, () => true],
  [/\bnew Kept\(/g, `new ${name}(`, () => true],
  [/import \{ Kept,/g, `import { ${name},`, () => true],
];

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const full = join(dir, n);
    if (statSync(full).isDirectory()) return SKIP_DIRS.has(n) ? [] : walk(full);
    return EXT.test(n) && n !== "package-lock.json" && n !== "rename.mjs" ? [full] : [];
  });
}

let files = 0;
let total = 0;
for (const file of walk(root)) {
  const before = readFileSync(file, "utf8");
  let after = before;
  let count = 0;
  for (const [re, rep, applies] of RULES) {
    if (!applies(file)) continue;
    after = after.replace(re, () => {
      count++;
      return rep;
    });
  }
  if (count > 0) {
    files++;
    total += count;
    console.log(`${dry ? "would change" : "changed"} ${relative(root, file)} (${count})`);
    if (!dry) writeFileSync(file, after);
  }
}
console.log(`\n${dry ? "Dry run: " : ""}${total} replacement(s) in ${files} file(s). Rebranded to ${name} (@${slug}/...). Run npm install next.`);
