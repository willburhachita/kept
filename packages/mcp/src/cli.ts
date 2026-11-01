#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { renderContract, verifyContract } from "@kept/core";
import { createKeptServer, VERSION } from "./index.js";
import { runStdio } from "./stdio.js";
import { verifyProofPack } from "./tools.js";

const HELP = `kept-mcp ${VERSION}

Usage:
  kept-mcp                       Start the MCP server on stdio (for Claude, Cursor, any MCP client)
  kept-mcp verify <file.json>    Verify a contract; exit code 1 if any property fails
  kept-mcp explain <file.json>   Print the contract in plain English
  kept-mcp verify-proof <file>   Verify a proof pack (signatures, hashes, re-run the verifier)
  kept-mcp --version | --help

Remote tools are enabled by environment variables:
  KEPT_API_URL=https://<deployment>.convex.site  KEPT_MANDATE_TOKEN=mt_...  KEPT_API_KEY=sk_...`;

function readJsonFile(path: string | undefined): unknown {
  if (!path) {
    console.error("Missing file path.\n\n" + HELP);
    process.exit(2);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

const [cmd, file] = process.argv.slice(2);

if (!cmd) {
  runStdio(createKeptServer());
} else if (cmd === "--version" || cmd === "-v") {
  console.log(VERSION);
} else if (cmd === "--help" || cmd === "-h") {
  console.log(HELP);
} else if (cmd === "verify") {
  const r = verifyContract(readJsonFile(file));
  if (!r.valid) {
    console.log("INVALID CONTRACT");
    for (const i of r.issues) console.log(`  ${i.severity}: ${i.path}: ${i.message}`);
    process.exit(1);
  }
  const rep = r.report;
  console.log(`${rep.ok ? "PROVED" : "FAILED"}: ${rep.summary}\n`);
  for (const p of rep.properties) {
    console.log(`  [${p.status === "proved" ? "ok" : p.severity === "warning" ? "warn" : "FAIL"}] ${p.title}`);
    if (p.counterexample) {
      for (const s of p.counterexample.steps) console.log(`        ${s.index}. ${s.narration.join(" ")}`);
      console.log(`        => ${p.counterexample.outcome}`);
    }
  }
  console.log(`\n  ${rep.outcomes.length} possible outcome(s); payee gets ${rep.bounds.payeeMinCents / 100}-${rep.bounds.payeeMaxCents / 100}; worst-case settlement by hour ${rep.bounds.latestSettlementHours}.`);
  process.exit(rep.ok ? 0 : 1);
} else if (cmd === "explain") {
  const r = verifyContract(readJsonFile(file));
  if (!r.valid) {
    console.log(JSON.stringify(r.issues, null, 2));
    process.exit(1);
  }
  const out = renderContract(r.ir);
  console.log([`# ${out.title}`, out.summary, "", ...out.money, "", "Promises:", ...out.promises.map((x) => `- ${x}`), "", "Rules:", ...out.rules.map((x) => `- ${x}`)].join("\n"));
} else if (cmd === "verify-proof") {
  const res = verifyProofPack(readJsonFile(file));
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.verdict === "valid" ? 0 : 1);
} else {
  console.error(`Unknown command "${cmd}".\n\n${HELP}`);
  process.exit(2);
}
