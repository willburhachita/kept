/**
 * Tools. Local tools run entirely offline on @kept/core. Remote tools are
 * listed only when the environment provides a deployment URL and a token:
 *   KEPT_API_URL        https://<deployment>.convex.site
 *   KEPT_MANDATE_TOKEN  mt_...   (agent spending tools)
 *   KEPT_API_KEY        sk_...   (contract management tools)
 */
import {
  CLAUSES_OUTPUT_SCHEMA,
  EXAMPLES,
  EXAMPLE_PROMPTS,
  SPEC_OUTPUT_SCHEMA,
  evaluateSpend,
  irHash,
  officeSuppliesMandate,
  renderContract,
  validateMandate,
  verifyChain,
  verifyContract,
  verifyMandate,
  type MandateRuntime,
  type SignedJournalEntry,
} from "@kept/core";
import type { JsonSchema, Tool } from "./protocol.js";
import { remote } from "./remote.js";

const obj = (properties: JsonSchema["properties"], required: string[] = []): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });

function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    throw new Error("Expected a JSON object (or a JSON string of one).");
  }
}

export const LANGUAGE_GUIDE = `A contract has: deadlines (hours after funding), evidence slots (deliverables with acceptance criteria), guarantees (promises: party + minimum amount + premise literals) and clauses (trigger + guard + money actions).
Triggers: activated | accepted(E) | rejected(E) | deadline(D). Literals: submitted(E), submitted_before(E,D), accepted(E), rejected(E), deadline_passed(D), each optionally negated; a guard is an AND.
Clauses fire at most once, in order. Actions: release (to payee) / refund (to funder), fixed cents or "remaining". The contract closes when nothing is held; submissions close at the last deadline.
Rules of thumb: "on time" = submitted_before, never "accepted before"; refund at a deadline only if NOT SUBMITTED; always handle rejected(E); use a join pair when one payment depends on two reviews.
The verifier explores every ordering and proves: conservation, no stranded funds, every promise, PayPal timing (authorize mode: everything inside 28 days), and warns about cut-off reviews.`;

function summarizeReport(r: ReturnType<typeof verifyContract>) {
  if (!r.valid) return { valid: false, issues: r.issues };
  const rep = r.report;
  return {
    valid: true,
    ok: rep.ok,
    summary: rep.summary,
    irHash: rep.irHash,
    properties: rep.properties.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      severity: p.severity,
      detail: p.detail,
      counterexample: p.counterexample ? { steps: p.counterexample.steps.map((s) => `${s.index}. ${s.narration.join(" ")}`), outcome: p.counterexample.outcome } : undefined,
    })),
    outcomes: rep.outcomes.map((o) => o.description),
    bounds: rep.bounds,
    lifecycle: rep.lifecycle,
    warnings: rep.warnings,
    stats: rep.stats,
  };
}

export function localTools(): Tool[] {
  return [
    {
      name: "verify_contract",
      title: "Verify a contract",
      description:
        "Exhaustively verify a payment contract (JSON in the Kept contract language). Explores every ordering of deliveries, reviews and deadlines and returns each property with a shortest counterexample when it fails, every possible outcome, and money/time bounds.",
      inputSchema: obj({ contract: { description: "The contract JSON (irVersion 1), as an object or a JSON string." }, fee_bps: { type: "integer", description: "Platform fee in basis points (default 0)." } }, ["contract"]),
      handler: (a) => summarizeReport(verifyContract(parseMaybeJson(a.contract), { feeBps: (a.fee_bps as number) ?? 0 })),
    },
    {
      name: "explain_contract",
      title: "Explain a contract",
      description: "Render a contract as plain English (money, deadlines, deliverables, promises, every rule). Deterministic: this is exactly what will run.",
      inputSchema: obj({ contract: { description: "Contract JSON object or string." }, fee_bps: { type: "integer" } }, ["contract"]),
      handler: (a) => {
        const r = verifyContract(parseMaybeJson(a.contract), { feeBps: (a.fee_bps as number) ?? 0 });
        if (!r.valid) return { valid: false, issues: r.issues };
        return renderContract(r.ir, { feeBps: (a.fee_bps as number) ?? 0 });
      },
    },
    {
      name: "contract_language",
      title: "Contract language reference",
      description: "Get the JSON Schemas and the semantics guide needed to write a valid contract.",
      inputSchema: obj({}),
      handler: () => ({ guide: LANGUAGE_GUIDE, specSchema: SPEC_OUTPUT_SCHEMA, clausesSchema: CLAUSES_OUTPUT_SCHEMA }),
    },
    {
      name: "example_contracts",
      title: "Example contracts",
      description: "Reference contracts (including two drafts with real bugs the verifier catches) and example prompts.",
      inputSchema: obj({}),
      handler: () => ({ contracts: EXAMPLES, prompts: EXAMPLE_PROMPTS, mandate: officeSuppliesMandate }),
    },
    {
      name: "verify_mandate",
      title: "Verify an agent mandate",
      description: "Validate an agent spending mandate and prove its caps (budget, per-purchase, count, expiry, merchant scope) with a hostile-agent simulation.",
      inputSchema: obj({ policy: { description: "Mandate policy JSON object or string." }, fee_bps: { type: "integer" } }, ["policy"]),
      handler: (a) => {
        const v = validateMandate(parseMaybeJson(a.policy));
        return v.ok ? { valid: true, report: verifyMandate(v.value, (a.fee_bps as number) ?? 0) } : { valid: false, issues: v.issues };
      },
    },
    {
      name: "check_spend",
      title: "Dry-run a spend",
      description: "Run the mandate guard on a hypothetical purchase and see approve / needs_approval / deny with reasons.",
      inputSchema: obj(
        {
          policy: { description: "Mandate policy JSON object or string." },
          state: { type: "object", description: "MandateRuntime: status, activatedAt, spentCents, reservedCents, purchases, recentSpendTimes." },
          request: { description: "{amountCents, currency, merchantEmail, description} (object or JSON string)" },
          fee_bps: { type: "integer" },
          now_ms: { type: "integer" },
        },
        ["policy", "request"],
      ),
      handler: (a) => {
        const v = validateMandate(parseMaybeJson(a.policy));
        if (!v.ok) return { valid: false, issues: v.issues };
        const now = (a.now_ms as number) ?? Date.now();
        const state: MandateRuntime = { status: "active", activatedAt: now - 1000, spentCents: 0, reservedCents: 0, purchases: 0, recentSpendTimes: [], ...(a.state as object) };
        return evaluateSpend(v.value, state, parseMaybeJson(a.request) as never, now, (a.fee_bps as number) ?? 0);
      },
    },
    {
      name: "verify_proof_pack",
      title: "Verify a proof pack",
      description: "Independently verify a contract proof pack: every journal hash and Ed25519 signature, the contract hash, and re-run the verifier to reproduce the report.",
      inputSchema: obj({ proof_pack: { description: "Proof pack JSON object or string." } }, ["proof_pack"]),
      handler: (a) => verifyProofPack(parseMaybeJson(a.proof_pack)),
    },
  ];
}

export function verifyProofPack(raw: unknown) {
  const pack = raw as {
    ir?: unknown;
    irHash?: string;
    feeBps?: number;
    verification?: { ok?: boolean; summary?: string } | null;
    journal?: SignedJournalEntry[];
    signingKeys?: Record<string, string>;
  };
  if (!pack || typeof pack !== "object" || !Array.isArray(pack.journal)) throw new Error("Not a proof pack (missing journal).");
  const chain = verifyChain(pack.journal, pack.signingKeys ?? {});
  const rerun = pack.ir ? verifyContract(pack.ir, { feeBps: pack.feeBps ?? 0 }) : null;
  const irHashMatches = rerun?.valid ? irHash(rerun.ir) === pack.irHash : false;
  const reproduced = rerun?.valid ? { ok: rerun.report.ok, summary: rerun.report.summary } : null;
  const reportMatches = reproduced !== null && pack.verification ? reproduced.ok === pack.verification.ok : null;
  return {
    verdict: chain.ok && irHashMatches && reportMatches !== false ? "valid" : "INVALID",
    journal: chain,
    irHashMatches,
    reproducedVerification: reproduced,
    claimedVerification: pack.verification ?? null,
    reportMatches,
  };
}

export function remoteTools(env: NodeJS.ProcessEnv = process.env): Tool[] {
  const base = env.KEPT_API_URL?.replace(/\/+$/, "");
  if (!base) return [];
  const tools: Tool[] = [];
  const mt = env.KEPT_MANDATE_TOKEN;
  const sk = env.KEPT_API_KEY;
  if (mt) {
    tools.push(
      {
        name: "get_mandate",
        title: "Get my spending mandate",
        description: "What this agent may buy: purpose, remaining budget, limits, allowed merchants and expiry. Call before spending.",
        inputSchema: obj({}),
        handler: () => remote(base, "GET", "/agent/v1/mandate", mt),
      },
      {
        name: "request_spend",
        title: "Request a purchase",
        description: "Pay a merchant from the mandate. Returns executing, screening, needs_approval or denied (final). Reuse idempotency_key when retrying.",
        inputSchema: obj(
          {
            merchant_email: { type: "string", description: "Merchant's PayPal email." },
            merchant_name: { type: "string" },
            amount_cents: { type: "integer" },
            currency: { type: "string" },
            description: { type: "string", description: "What is bought and why it fits the purpose." },
            idempotency_key: { type: "string" },
          },
          ["merchant_email", "merchant_name", "amount_cents", "description"],
        ),
        handler: (a) =>
          remote(base, "POST", "/agent/v1/spends", mt, {
            merchantEmail: a.merchant_email,
            merchantName: a.merchant_name,
            amountCents: a.amount_cents,
            currency: (a.currency as string) ?? "USD",
            description: a.description,
            idempotencyKey: (a.idempotency_key as string) ?? crypto.randomUUID(),
          }),
      },
      {
        name: "get_spend",
        title: "Get purchase status",
        description: "Status of a purchase you requested.",
        inputSchema: obj({ spend_id: { type: "string" } }, ["spend_id"]),
        handler: (a) => remote(base, "GET", `/agent/v1/spends/${encodeURIComponent(String(a.spend_id))}`, mt),
      },
    );
  }
  if (sk) {
    tools.push(
      { name: "list_contracts", title: "List contracts", description: "Contracts you created or take part in.", inputSchema: obj({}), handler: () => remote(base, "GET", "/v1/contracts", sk) },
      {
        name: "get_contract",
        title: "Get a contract",
        description: "Full contract view: status, plain-English terms, verification, money, deadlines and next actions.",
        inputSchema: obj({ contract_id: { type: "string" } }, ["contract_id"]),
        handler: (a) => remote(base, "GET", `/v1/contracts/${encodeURIComponent(String(a.contract_id))}`, sk),
      },
      {
        name: "create_contract",
        title: "Create a contract",
        description: "Create a contract from a plain-English description (compiled and verified by the server) or from contract JSON. Returns an invite link for the counterparty.",
        inputSchema: obj(
          { prompt: { type: "string" }, role: { type: "string", description: "funder or payee (your role)" }, counterparty_email: { type: "string" }, contract: { type: "object" } },
          ["role"],
        ),
        handler: (a) =>
          remote(base, "POST", "/v1/contracts", sk, { prompt: a.prompt ?? "", role: a.role, counterpartyEmail: a.counterparty_email, ir: a.contract, compile: !a.contract }),
      },
      {
        name: "compile_contract",
        title: "Compile a contract",
        description: "Start (or check) AI compilation of a contract's description into verified terms.",
        inputSchema: obj({ contract_id: { type: "string" }, check_only: { type: "boolean" } }, ["contract_id"]),
        handler: (a) => remote(base, a.check_only ? "GET" : "POST", `/v1/contracts/${encodeURIComponent(String(a.contract_id))}/compile`, sk),
      },
      {
        name: "approve_contract",
        title: "Approve terms",
        description: "Approve the exact verified terms by their hash.",
        inputSchema: obj({ contract_id: { type: "string" }, terms_hash: { type: "string" } }, ["contract_id", "terms_hash"]),
        handler: (a) => remote(base, "POST", `/v1/contracts/${encodeURIComponent(String(a.contract_id))}/approve`, sk, { termsHash: a.terms_hash }),
      },
      {
        name: "contract_proof",
        title: "Download proof pack",
        description: "The signed journal and verification report; check it with verify_proof_pack.",
        inputSchema: obj({ contract_id: { type: "string" } }, ["contract_id"]),
        handler: (a) => remote(base, "GET", `/v1/contracts/${encodeURIComponent(String(a.contract_id))}/proof`, sk),
      },
    );
  }
  return tools;
}

export function allTools(env: NodeJS.ProcessEnv = process.env): Tool[] {
  return [...localTools(), ...remoteTools(env)];
}
