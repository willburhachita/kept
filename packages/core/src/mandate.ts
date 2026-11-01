/**
 * Agent spending mandates.
 *
 * An AI agent never gets a card. It gets a mandate: a budget held on the
 * owner's PayPal authorization plus a policy. Every spend request is checked
 * by `evaluateSpend`, a pure function, so the guarantees below are properties
 * of code, not of the agent's good behaviour:
 *
 *   spent + reserved <= budget          (budget cap, inductive invariant)
 *   each spend <= perPurchaseMax         (per-purchase cap)
 *   purchases <= maxPurchases            (count cap)
 *   no spend after expiry                (time cap, inside PayPal's 29 days)
 *   merchant in allowlist (if set)       (scope)
 */
import { authorizationAmount, feeForRelease, formatCents, maxFee } from "./fees.js";
import { SUPPORTED_CURRENCIES, type Currency, type Issue, type ValidationResult } from "./ir.js";
import { PAYPAL_RULES } from "./verifier.js";

export interface MandatePolicy {
  version: 1;
  title: string;
  /** What the agent may buy, in plain words. Shown to humans and to the AI screener. */
  purpose: string;
  currency: Currency;
  budgetCents: number;
  perPurchaseMaxCents: number;
  maxPurchases: number;
  expiresAfterHours: number;
  /** Lowercase emails ("shop@example.com") or domains ("@example.com"). Empty = any merchant. */
  allowedMerchants: string[];
  /** Spends above this need the owner's approval. null = never. */
  approvalAboveCents: number | null;
  maxPerHour: number;
}

export const MANDATE_LIMITS = {
  minBudgetCents: 100,
  maxBudgetCents: 1_000_000,
  maxPurchases: 1000,
  maxMerchants: 50,
  maxPerHour: 120,
  maxTitle: 120,
  maxPurpose: 600,
  maxDescription: 500,
} as const;

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const DOMAIN = /^@[a-z0-9.-]+\.[a-z]{2,}$/;

export function validateMandate(raw: unknown): ValidationResult<MandatePolicy> {
  const issues: Issue[] = [];
  const err = (path: string, message: string, code = "invalid") => issues.push({ code, path, message, severity: "error" });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, issues: [{ code: "type", path: "$", message: "mandate must be an object", severity: "error" }] };
  const r = raw as Record<string, unknown>;
  const int = (k: string, min: number, max: number): number => {
    const v = r[k];
    if (typeof v !== "number" || !Number.isInteger(v)) {
      err(`$.${k}`, `${k} must be an integer`, "type");
      return 0;
    }
    if (v < min || v > max) err(`$.${k}`, `${k} must be between ${min} and ${max}`, "range");
    return v;
  };
  const str = (k: string, max: number): string => {
    const v = r[k];
    if (typeof v !== "string" || !v.trim()) {
      err(`$.${k}`, `${k} must be a non-empty string`, "type");
      return "";
    }
    if (v.trim().length > max) err(`$.${k}`, `${k} must be at most ${max} characters`, "too_long");
    return v.trim();
  };
  const title = str("title", MANDATE_LIMITS.maxTitle);
  const purpose = str("purpose", MANDATE_LIMITS.maxPurpose);
  const currency = (SUPPORTED_CURRENCIES as readonly string[]).includes(r.currency as string) ? (r.currency as Currency) : (err("$.currency", `currency must be one of ${SUPPORTED_CURRENCIES.join(", ")}`), "USD" as Currency);
  const budgetCents = int("budgetCents", MANDATE_LIMITS.minBudgetCents, MANDATE_LIMITS.maxBudgetCents);
  const perPurchaseMaxCents = int("perPurchaseMaxCents", 1, Math.max(1, budgetCents));
  const maxPurchases = int("maxPurchases", 1, MANDATE_LIMITS.maxPurchases);
  const expiresAfterHours = int("expiresAfterHours", 1, PAYPAL_RULES.authorizationBudgetHours);
  const maxPerHour = int("maxPerHour", 1, MANDATE_LIMITS.maxPerHour);
  let approvalAboveCents: number | null = null;
  if (r.approvalAboveCents !== null && r.approvalAboveCents !== undefined) approvalAboveCents = int("approvalAboveCents", 0, Math.max(0, perPurchaseMaxCents));
  const allowedMerchants: string[] = [];
  if (!Array.isArray(r.allowedMerchants)) err("$.allowedMerchants", "allowedMerchants must be an array", "type");
  else {
    if (r.allowedMerchants.length > MANDATE_LIMITS.maxMerchants) err("$.allowedMerchants", `at most ${MANDATE_LIMITS.maxMerchants} merchants`, "too_many");
    r.allowedMerchants.slice(0, MANDATE_LIMITS.maxMerchants).forEach((m, i) => {
      const v = typeof m === "string" ? m.trim().toLowerCase() : "";
      if (!EMAIL.test(v) && !DOMAIN.test(v)) err(`$.allowedMerchants[${i}]`, `"${String(m)}" is not an email or @domain`, "format");
      else allowedMerchants.push(v);
    });
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    issues,
    value: { version: 1, title, purpose, currency, budgetCents, perPurchaseMaxCents, maxPurchases, expiresAfterHours, allowedMerchants, approvalAboveCents, maxPerHour },
  };
}

export interface MandateRuntime {
  status: "active" | "draft" | "awaiting_funding" | "funding" | "closing" | "closed" | "revoked" | "frozen";
  activatedAt: number | null;
  spentCents: number;
  reservedCents: number;
  purchases: number;
  /** Timestamps (ms) of spends approved in the last hour, for velocity. */
  recentSpendTimes: number[];
}

export interface SpendRequest {
  amountCents: number;
  currency: string;
  merchantEmail: string;
  description: string;
}

export type SpendDecision = "approve" | "needs_approval" | "deny";

export interface SpendEvaluation {
  decision: SpendDecision;
  reasons: string[];
  feeCents: number;
  remainingAfterCents: number;
}

export function merchantAllowed(policy: MandatePolicy, merchantEmail: string): boolean {
  if (policy.allowedMerchants.length === 0) return true;
  const email = merchantEmail.trim().toLowerCase();
  const domain = email.split("@")[1] ?? "";
  return policy.allowedMerchants.some((m) => (m.startsWith("@") ? domain === m.slice(1) : email === m));
}

/** The guard. Pure and total: it decides, it never throws for bad input. */
export function evaluateSpend(policy: MandatePolicy, rt: MandateRuntime, req: SpendRequest, nowMs: number, feeBps: number): SpendEvaluation {
  const deny: string[] = [];
  const available = policy.budgetCents - rt.spentCents - rt.reservedCents;
  const amount = req.amountCents;
  if (rt.status !== "active") deny.push(`mandate is ${rt.status}, not active`);
  if (rt.activatedAt === null) deny.push("mandate has not been funded");
  else if (nowMs >= rt.activatedAt + policy.expiresAfterHours * 3_600_000) deny.push("mandate has expired");
  if (!Number.isSafeInteger(amount) || amount <= 0) deny.push("amount must be a positive whole number of cents");
  if (req.currency !== policy.currency) deny.push(`currency must be ${policy.currency}`);
  if (Number.isSafeInteger(amount) && amount > policy.perPurchaseMaxCents) deny.push(`amount exceeds the per-purchase limit of ${formatCents(policy.perPurchaseMaxCents, policy.currency)}`);
  if (Number.isSafeInteger(amount) && amount > available) deny.push(`amount exceeds the remaining budget of ${formatCents(Math.max(0, available), policy.currency)}`);
  if (rt.purchases >= policy.maxPurchases) deny.push(`purchase limit of ${policy.maxPurchases} reached`);
  if (!EMAIL.test(req.merchantEmail.trim().toLowerCase())) deny.push("merchant must be identified by a valid PayPal email");
  else if (!merchantAllowed(policy, req.merchantEmail)) deny.push("merchant is not on this mandate's allowlist");
  const recent = rt.recentSpendTimes.filter((t) => nowMs - t < 3_600_000).length;
  if (recent >= policy.maxPerHour) deny.push(`velocity limit of ${policy.maxPerHour} purchases per hour reached`);
  const desc = req.description.trim();
  if (!desc) deny.push("a description of the purchase is required");
  if (desc.length > MANDATE_LIMITS.maxDescription) deny.push(`description must be at most ${MANDATE_LIMITS.maxDescription} characters`);

  const fee = Number.isSafeInteger(amount) && amount > 0 ? feeForRelease(rt.spentCents + rt.reservedCents, amount, feeBps) : 0;
  if (deny.length) return { decision: "deny", reasons: deny, feeCents: 0, remainingAfterCents: Math.max(0, available) };
  if (policy.approvalAboveCents !== null && amount > policy.approvalAboveCents) {
    return {
      decision: "needs_approval",
      reasons: [`amount is above the auto-approve limit of ${formatCents(policy.approvalAboveCents, policy.currency)}`],
      feeCents: fee,
      remainingAfterCents: available - amount,
    };
  }
  return { decision: "approve", reasons: ["within every limit of the mandate"], feeCents: fee, remainingAfterCents: available - amount };
}

export interface MandateProperty {
  id: string;
  title: string;
  status: "proved" | "violated";
  detail: string;
}

export interface MandateReport {
  ok: boolean;
  properties: MandateProperty[];
  authorizationCents: number;
  maxFeeCents: number;
  stats: { simulatedRequests: number; seed: number };
}

/** Deterministic PRNG so reports are reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Prove the caps. The budget cap follows by induction (the guard only
 * approves when amount <= budget - spent - reserved, and that is the only
 * way spent/reserved grow). We also run a seeded adversarial simulation of
 * hostile agents as an executable witness of the same facts.
 */
export function verifyMandate(policy: MandatePolicy, feeBps: number, opts: { requests?: number; seed?: number } = {}): MandateReport {
  const requests = opts.requests ?? 20_000;
  const seed = opts.seed ?? 0x5eed;
  const rand = mulberry32(seed);
  const t0 = 1_700_000_000_000;
  const rt: MandateRuntime = { status: "active", activatedAt: t0, spentCents: 0, reservedCents: 0, purchases: 0, recentSpendTimes: [] };
  let clock = t0;
  let overBudget = false;
  let overPerPurchase = false;
  let overCount = false;
  let afterExpiry = false;
  let outsideScope = false;
  const merchants = [...policy.allowedMerchants.map((m) => (m.startsWith("@") ? `shop${m}` : m)), "attacker@evil.example", "ops@unknown.example"];
  for (let i = 0; i < requests; i++) {
    clock += Math.floor(rand() * 3_600_000 * (policy.expiresAfterHours / Math.max(1, requests / 50)));
    const r = rand();
    const amount = r < 0.1 ? policy.perPurchaseMaxCents + 1 + Math.floor(rand() * 1000) : r < 0.15 ? -5 : 1 + Math.floor(rand() * policy.perPurchaseMaxCents);
    const merchantEmail = merchants[Math.floor(rand() * merchants.length)];
    const ev = evaluateSpend(policy, rt, { amountCents: amount, currency: policy.currency, merchantEmail, description: "simulated purchase" }, clock, feeBps);
    if (ev.decision === "deny") continue;
    // needs_approval: assume a careless owner who approves everything (worst case)
    if (amount > policy.perPurchaseMaxCents) overPerPurchase = true;
    if (rt.purchases + 1 > policy.maxPurchases) overCount = true;
    if (clock >= t0 + policy.expiresAfterHours * 3_600_000) afterExpiry = true;
    if (!merchantAllowed(policy, merchantEmail)) outsideScope = true;
    rt.spentCents += amount;
    rt.purchases += 1;
    rt.recentSpendTimes = [...rt.recentSpendTimes.filter((t) => clock - t < 3_600_000), clock];
    if (rt.spentCents + rt.reservedCents > policy.budgetCents) overBudget = true;
  }
  const fee = maxFee(policy.budgetCents, feeBps);
  const fmt = (c: number) => formatCents(c, policy.currency);
  const properties: MandateProperty[] = [
    { id: "budget_cap", title: `Never spends more than ${fmt(policy.budgetCents)}`, status: overBudget ? "violated" : "proved", detail: "Inductive invariant spent + reserved ≤ budget, plus a seeded simulation with hostile agents." },
    { id: "per_purchase_cap", title: `No single purchase above ${fmt(policy.perPurchaseMaxCents)}`, status: overPerPurchase ? "violated" : "proved", detail: "Checked by the guard on every request." },
    { id: "count_cap", title: `At most ${policy.maxPurchases} purchases`, status: overCount ? "violated" : "proved", detail: "Checked by the guard on every request." },
    {
      id: "expiry",
      title: `Stops after ${policy.expiresAfterHours} hours`,
      status: afterExpiry || policy.expiresAfterHours > PAYPAL_RULES.authorizationBudgetHours ? "violated" : "proved",
      detail: "Expiry is inside PayPal's 29-day authorization window (28-day budget).",
    },
    {
      id: "merchant_scope",
      title: policy.allowedMerchants.length ? `Only pays ${policy.allowedMerchants.length} allowed merchant(s)` : "Any merchant (no allowlist)",
      status: outsideScope ? "violated" : "proved",
      detail: policy.allowedMerchants.length ? policy.allowedMerchants.join(", ") : "Consider adding an allowlist.",
    },
  ];
  return {
    ok: properties.every((p) => p.status === "proved"),
    properties,
    authorizationCents: authorizationAmount(policy.budgetCents, feeBps),
    maxFeeCents: fee,
    stats: { simulatedRequests: requests, seed },
  };
}
