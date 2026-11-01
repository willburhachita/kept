import { createServer } from "./protocol.js";
import { allTools } from "./tools.js";

export * from "./protocol.js";
export * from "./stdio.js";
export * from "./tools.js";

export const VERSION = "0.1.0";

export const INSTRUCTIONS =
  "Kept verifies payment contracts before any money moves. Use contract_language and example_contracts to write a contract, verify_contract to prove it (read counterexamples carefully), and explain_contract to show the plain-English version. " +
  "If spending tools are present you act under a mandate: call get_mandate first, then request_spend; a denied answer is final policy, not an error to work around.";

export function createKeptServer(env: NodeJS.ProcessEnv = process.env) {
  return createServer({ name: "kept", version: VERSION, instructions: INSTRUCTIONS, tools: () => allTools(env) });
}
