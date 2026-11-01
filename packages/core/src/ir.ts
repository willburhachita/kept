/**
 * The contract language ("IR").
 *
 * A contract is a small, total, decidable program: a handful of deadlines,
 * evidence slots, promises (the spec) and clauses (the implementation).
 * There are no loops and no arithmetic beyond fixed amounts and "everything
 * still held", which is what makes exhaustive verification possible.
 */
import { canonicalJson, sha256Hex } from "./crypto.js";

export const IR_VERSION = 1 as const;
export const ENGINE_VERSION = "1.0.0";

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export const FUNDING_MODES = ["authorize", "escrow"] as const;
/**
 * authorize: the funder's money stays on their PayPal account as an
 *            authorization hold and is captured only when released.
 * escrow:    the full amount is captured at the start and held by the
 *            platform until it is released or refunded.
 */
export type FundingMode = (typeof FUNDING_MODES)[number];

export const PREDICATE_KINDS = [
  "submitted",
  "submitted_before",
  "accepted",
  "rejected",
  "deadline_passed",
] as const;
export type PredicateKind = (typeof PREDICATE_KINDS)[number];

/** Kinds a promise's premise may use: everything except deadline_passed (see readPremise). */
export const PREMISE_KINDS: readonly PredicateKind[] = PREDICATE_KINDS.filter((k) => k !== "deadline_passed");

/** A (possibly negated) fact about evidence or time. Guards are ANDs of literals. */
export interface Literal {
  kind: PredicateKind;
  evidence: string | null;
  deadline: string | null;
  negate: boolean;
}

export const TRIGGER_KINDS = ["activated", "accepted", "rejected", "deadline"] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export interface Trigger {
  on: TriggerKind;
  evidence: string | null;
  deadline: string | null;
}

export const ACTION_OPS = ["release", "refund"] as const;
export type ActionOp = (typeof ACTION_OPS)[number];

/** release = pay the payee, refund = return to the funder. */
export interface MoneyAction {
  op: ActionOp;
  /** Fixed amount in minor units. Must be null when `remaining` is true. */
  cents: number | null;
  /** Move everything still held. */
  remaining: boolean;
}

export interface Clause {
  id: string;
  label: string;
  trigger: Trigger;
  guard: Literal[];
  actions: MoneyAction[];
}

export interface Deadline {
  id: string;
  label: string;
  /** Hours after activation (funding confirmed). */
  afterHours: number;
}

export const EVIDENCE_KINDS = ["file", "text", "link"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface EvidenceSlot {
  id: string;
  label: string;
  kind: EvidenceKind;
  /** Acceptance criteria the AI examiner checks one by one. */
  criteria: string[];
  /** Minimum examiner confidence for auto-acceptance (after the challenge window). */
  autoAcceptConfidence: number;
}

export const PARTIES = ["payee", "funder"] as const;
export type Party = (typeof PARTIES)[number];

/** A promise both sides read and approve. The verifier proves the clauses keep it. */
export interface Guarantee {
  id: string;
  label: string;
  party: Party;
  atLeastCents: number;
  /** Premise: the promise applies on every outcome where all literals hold. */
  when: Literal[];
}

export interface ContractIR {
  irVersion: typeof IR_VERSION;
  title: string;
  summary: string;
  currency: Currency;
  principalCents: number;
  fundingMode: FundingMode;
  challengeWindowHours: number;
  deadlines: Deadline[];
  evidence: EvidenceSlot[];
  guarantees: Guarantee[];
  clauses: Clause[];
}

/** Everything except the clauses: the "what", written and approved before the "how". */
export type ContractSpec = Omit<ContractIR, "clauses">;

export const LIMITS = {
  maxDeadlines: 6,
  maxEvidence: 5,
  maxClauses: 24,
  maxActionsPerClause: 3,
  maxLiteralsPerGuard: 6,
  maxGuarantees: 8,
  maxCriteria: 8,
  minPrincipalCents: 100,
  maxPrincipalCents: 1_000_000,
  maxAfterHours: 4080,
  minChallengeWindowHours: 1,
  maxChallengeWindowHours: 168,
  maxTitle: 120,
  maxSummary: 400,
  maxLabel: 120,
  maxCriterion: 300,
} as const;

export const ID_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export interface Issue {
  code: string;
  path: string;
  message: string;
  severity: "error" | "warning";
}

export type ValidationResult<T> =
  | { ok: true; value: T; issues: Issue[] }
  | { ok: false; issues: Issue[] };

// ---------------------------------------------------------------------------
// Validation. Input is `unknown` on purpose: it usually comes from an LLM or
// an HTTP body. The validator never trusts shape and returns a normalized
// deep copy that contains only known fields.
// ---------------------------------------------------------------------------

class Collector {
  issues: Issue[] = [];
  error(path: string, code: string, message: string) {
    this.issues.push({ code, path, message, severity: "error" });
  }
  warn(path: string, code: string, message: string) {
    this.issues.push({ code, path, message, severity: "warning" });
  }
  get failed() {
    return this.issues.some((i) => i.severity === "error");
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function readString(
  c: Collector,
  obj: Record<string, unknown>,
  key: string,
  path: string,
  opts: { max: number; min?: number },
): string {
  const v = obj[key];
  if (typeof v !== "string") {
    c.error(`${path}.${key}`, "type", `${key} must be a string`);
    return "";
  }
  const s = v.trim();
  if (s.length < (opts.min ?? 1)) c.error(`${path}.${key}`, "too_short", `${key} must not be empty`);
  if (s.length > opts.max) c.error(`${path}.${key}`, "too_long", `${key} must be at most ${opts.max} characters`);
  return s;
}

function readInt(
  c: Collector,
  obj: Record<string, unknown>,
  key: string,
  path: string,
  min: number,
  max: number,
): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isInteger(v)) {
    c.error(`${path}.${key}`, "type", `${key} must be an integer`);
    return 0;
  }
  if (v < min || v > max) c.error(`${path}.${key}`, "range", `${key} must be between ${min} and ${max}`);
  return v;
}

function readEnum<T extends string>(
  c: Collector,
  obj: Record<string, unknown>,
  key: string,
  path: string,
  values: readonly T[],
): T {
  const v = obj[key];
  if (typeof v !== "string" || !(values as readonly string[]).includes(v)) {
    c.error(`${path}.${key}`, "enum", `${key} must be one of: ${values.join(", ")}`);
    return values[0];
  }
  return v as T;
}

function readNullableRef(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function readArray(c: Collector, obj: Record<string, unknown>, key: string, path: string, max: number, min = 0): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) {
    c.error(`${path}.${key}`, "type", `${key} must be an array`);
    return [];
  }
  if (v.length < min) c.error(`${path}.${key}`, "too_few", `${key} needs at least ${min} item(s)`);
  if (v.length > max) c.error(`${path}.${key}`, "too_many", `${key} allows at most ${max} item(s)`);
  return v.slice(0, max);
}

function readId(c: Collector, obj: Record<string, unknown>, path: string, seen: Set<string>): string {
  const v = obj.id;
  if (typeof v !== "string" || !ID_PATTERN.test(v)) {
    c.error(`${path}.id`, "id", "id must match ^[a-z][a-z0-9_]{0,39}$");
    return typeof v === "string" ? v : "";
  }
  if (seen.has(v)) c.error(`${path}.id`, "duplicate_id", `duplicate id "${v}"`);
  seen.add(v);
  return v;
}

interface RefSets {
  deadlines: Set<string>;
  evidence: Set<string>;
}

function readLiteral(c: Collector, raw: unknown, path: string, refs: RefSets): Literal {
  if (!isObject(raw)) {
    c.error(path, "type", "literal must be an object");
    return { kind: "submitted", evidence: null, deadline: null, negate: false };
  }
  const kind = readEnum(c, raw, "kind", path, PREDICATE_KINDS);
  let evidence = readNullableRef(raw, "evidence");
  let deadline = readNullableRef(raw, "deadline");
  const negate = raw.negate === true;
  if (raw.negate !== undefined && typeof raw.negate !== "boolean") c.error(`${path}.negate`, "type", "negate must be a boolean");
  const needsEvidence = kind !== "deadline_passed";
  const needsDeadline = kind === "submitted_before" || kind === "deadline_passed";
  if (needsEvidence) {
    if (!evidence || !refs.evidence.has(evidence)) c.error(`${path}.evidence`, "unknown_ref", `literal "${kind}" needs a known evidence id`);
  } else evidence = null;
  if (needsDeadline) {
    if (!deadline || !refs.deadlines.has(deadline)) c.error(`${path}.deadline`, "unknown_ref", `literal "${kind}" needs a known deadline id`);
  } else deadline = null;
  return { kind, evidence, deadline, negate };
}

function readLiterals(c: Collector, obj: Record<string, unknown>, key: string, path: string, refs: RefSets): Literal[] {
  return readArray(c, obj, key, path, LIMITS.maxLiteralsPerGuard).map((l, i) => readLiteral(c, l, `${path}.${key}[${i}]`, refs));
}

/**
 * A promise's premise. Promises are judged on how the contract ends, and a
 * contract that closes early never sees its later deadlines pass, so a
 * deadline_passed premise could make a broken promise look kept.
 */
function readPremise(c: Collector, obj: Record<string, unknown>, path: string, refs: RefSets): Literal[] {
  const when = readLiterals(c, obj, "when", path, refs);
  when.forEach((l, i) => {
    if (l.kind === "deadline_passed") {
      c.error(`${path}.when[${i}]`, "deadline_premise", "Promises cannot depend on a deadline passing; describe the outcome instead (e.g. evidence accepted / rejected / submitted before a deadline)");
    }
  });
  return when;
}

function readSpecInto(c: Collector, raw: unknown): ContractSpec & { refs: RefSets } {
  const path = "$";
  const empty: RefSets = { deadlines: new Set(), evidence: new Set() };
  if (!isObject(raw)) {
    c.error(path, "type", "contract must be an object");
    return {
      irVersion: IR_VERSION, title: "", summary: "", currency: "USD", principalCents: 0, fundingMode: "authorize",
      challengeWindowHours: 24, deadlines: [], evidence: [], guarantees: [], refs: empty,
    };
  }
  if (raw.irVersion !== undefined && raw.irVersion !== IR_VERSION) c.error(`${path}.irVersion`, "version", `irVersion must be ${IR_VERSION}`);
  const title = readString(c, raw, "title", path, { max: LIMITS.maxTitle });
  const summary = typeof raw.summary === "string" ? raw.summary.trim().slice(0, LIMITS.maxSummary) : "";
  const currency = readEnum(c, raw, "currency", path, SUPPORTED_CURRENCIES);
  const principalCents = readInt(c, raw, "principalCents", path, LIMITS.minPrincipalCents, LIMITS.maxPrincipalCents);
  const fundingMode = readEnum(c, raw, "fundingMode", path, FUNDING_MODES);
  const challengeWindowHours = readInt(c, raw, "challengeWindowHours", path, LIMITS.minChallengeWindowHours, LIMITS.maxChallengeWindowHours);

  const ids = new Set<string>();
  const refs: RefSets = { deadlines: new Set(), evidence: new Set() };

  const deadlines: Deadline[] = readArray(c, raw, "deadlines", path, LIMITS.maxDeadlines, 1).map((d, i) => {
    const p = `${path}.deadlines[${i}]`;
    if (!isObject(d)) {
      c.error(p, "type", "deadline must be an object");
      return { id: "", label: "", afterHours: 0 };
    }
    const id = readId(c, d, p, ids);
    refs.deadlines.add(id);
    return { id, label: readString(c, d, "label", p, { max: LIMITS.maxLabel }), afterHours: readInt(c, d, "afterHours", p, 1, LIMITS.maxAfterHours) };
  });

  const evidence: EvidenceSlot[] = readArray(c, raw, "evidence", path, LIMITS.maxEvidence).map((e, i) => {
    const p = `${path}.evidence[${i}]`;
    if (!isObject(e)) {
      c.error(p, "type", "evidence slot must be an object");
      return { id: "", label: "", kind: "file" as const, criteria: [], autoAcceptConfidence: 0.9 };
    }
    const id = readId(c, e, p, ids);
    refs.evidence.add(id);
    const criteria = readArray(c, e, "criteria", p, LIMITS.maxCriteria, 1).map((cr, j) => {
      if (typeof cr !== "string" || !cr.trim()) {
        c.error(`${p}.criteria[${j}]`, "type", "criterion must be a non-empty string");
        return "";
      }
      if (cr.length > LIMITS.maxCriterion) c.error(`${p}.criteria[${j}]`, "too_long", `criterion must be at most ${LIMITS.maxCriterion} characters`);
      return cr.trim();
    });
    let conf = e.autoAcceptConfidence;
    if (typeof conf !== "number" || !Number.isFinite(conf)) {
      c.error(`${p}.autoAcceptConfidence`, "type", "autoAcceptConfidence must be a number");
      conf = 0.9;
    } else if (conf < 0.5 || conf > 0.99) {
      c.error(`${p}.autoAcceptConfidence`, "range", "autoAcceptConfidence must be between 0.5 and 0.99");
    }
    return {
      id,
      label: readString(c, e, "label", p, { max: LIMITS.maxLabel }),
      kind: readEnum(c, e, "kind", p, EVIDENCE_KINDS),
      criteria,
      autoAcceptConfidence: Math.round((conf as number) * 100) / 100,
    };
  });

  const gIds = new Set<string>();
  const guarantees: Guarantee[] = readArray(c, raw, "guarantees", path, LIMITS.maxGuarantees).map((g, i) => {
    const p = `${path}.guarantees[${i}]`;
    if (!isObject(g)) {
      c.error(p, "type", "guarantee must be an object");
      return { id: "", label: "", party: "payee" as const, atLeastCents: 0, when: [] };
    }
    return {
      id: readId(c, g, p, gIds),
      label: readString(c, g, "label", p, { max: LIMITS.maxLabel }),
      party: readEnum(c, g, "party", p, PARTIES),
      atLeastCents: readInt(c, g, "atLeastCents", p, 1, Math.max(1, principalCents)),
      when: readPremise(c, g, p, refs),
    };
  });

  return { irVersion: IR_VERSION, title, summary, currency, principalCents, fundingMode, challengeWindowHours, deadlines, evidence, guarantees, refs };
}

function readClauses(c: Collector, rawClauses: unknown, spec: ContractSpec, refs: RefSets): Clause[] {
  const holder = { clauses: rawClauses } as Record<string, unknown>;
  const ids = new Set<string>();
  return readArray(c, holder, "clauses", "$", LIMITS.maxClauses, 1).map((cl, i) => {
    const p = `$.clauses[${i}]`;
    if (!isObject(cl)) {
      c.error(p, "type", "clause must be an object");
      return { id: "", label: "", trigger: { on: "activated" as const, evidence: null, deadline: null }, guard: [], actions: [] };
    }
    const id = readId(c, cl, p, ids);
    const label = readString(c, cl, "label", p, { max: LIMITS.maxLabel });
    let trigger: Trigger = { on: "activated", evidence: null, deadline: null };
    if (!isObject(cl.trigger)) c.error(`${p}.trigger`, "type", "trigger must be an object");
    else {
      const on = readEnum(c, cl.trigger, "on", `${p}.trigger`, TRIGGER_KINDS);
      let evidence = readNullableRef(cl.trigger, "evidence");
      let deadline = readNullableRef(cl.trigger, "deadline");
      if (on === "accepted" || on === "rejected") {
        if (!evidence || !refs.evidence.has(evidence)) c.error(`${p}.trigger.evidence`, "unknown_ref", `trigger "${on}" needs a known evidence id`);
        deadline = null;
      } else if (on === "deadline") {
        if (!deadline || !refs.deadlines.has(deadline)) c.error(`${p}.trigger.deadline`, "unknown_ref", `trigger "deadline" needs a known deadline id`);
        evidence = null;
      } else {
        evidence = null;
        deadline = null;
      }
      trigger = { on, evidence, deadline };
    }
    const guard = readLiterals(c, cl, "guard", p, refs);
    const actions: MoneyAction[] = readArray(c, cl, "actions", p, LIMITS.maxActionsPerClause, 1).map((a, j) => {
      const ap = `${p}.actions[${j}]`;
      if (!isObject(a)) {
        c.error(ap, "type", "action must be an object");
        return { op: "refund" as const, cents: null, remaining: true };
      }
      const op = readEnum(c, a, "op", ap, ACTION_OPS);
      const remaining = a.remaining === true;
      if (remaining) return { op, cents: null, remaining: true };
      const cents = readInt(c, a, "cents", ap, 1, Math.max(1, spec.principalCents));
      return { op, cents, remaining: false };
    });
    return { id, label, trigger, guard, actions };
  });
}

/** Validate a spec (no clauses). */
export function validateSpec(raw: unknown): ValidationResult<ContractSpec> {
  const c = new Collector();
  const { refs: _refs, ...spec } = readSpecInto(c, raw);
  return c.failed ? { ok: false, issues: c.issues } : { ok: true, value: spec, issues: c.issues };
}

/** Validate clauses against an already-validated spec. */
export function validateClauses(spec: ContractSpec, rawClauses: unknown): ValidationResult<Clause[]> {
  const c = new Collector();
  const refs: RefSets = { deadlines: new Set(spec.deadlines.map((d) => d.id)), evidence: new Set(spec.evidence.map((e) => e.id)) };
  const clauses = readClauses(c, rawClauses, spec, refs);
  return c.failed ? { ok: false, issues: c.issues } : { ok: true, value: clauses, issues: c.issues };
}

/** Validate and normalize a full contract. */
export function validateContract(raw: unknown): ValidationResult<ContractIR> {
  const c = new Collector();
  const { refs, ...spec } = readSpecInto(c, raw);
  const clauses = isObject(raw) ? readClauses(c, raw.clauses, spec, refs) : [];
  if (c.failed) return { ok: false, issues: c.issues };
  return { ok: true, value: { ...spec, clauses }, issues: c.issues };
}

/** Deadlines in firing order: by offset, then declaration order. */
export function sortedDeadlines(ir: Pick<ContractIR, "deadlines">): Deadline[] {
  return ir.deadlines
    .map((d, i) => ({ d, i }))
    .sort((a, b) => a.d.afterHours - b.d.afterHours || a.i - b.i)
    .map((x) => x.d);
}

/** The submission window closes when the last deadline passes. */
export function horizonHours(ir: Pick<ContractIR, "deadlines">): number {
  return ir.deadlines.reduce((m, d) => Math.max(m, d.afterHours), 0);
}

/** Content address of the contract program. */
export function irHash(ir: ContractIR): string {
  return sha256Hex(canonicalJson(ir));
}

export interface TermsBinding {
  irHash: string;
  funderId: string;
  payeeId: string;
  feeBps: number;
  engineVersion: string;
}

/**
 * The exact thing both parties approve: the program, who plays which role,
 * the platform fee and the verifier version. Change any of it and approvals
 * no longer match.
 */
export function termsHash(t: TermsBinding): string {
  return sha256Hex(canonicalJson({ v: 1, ...t }));
}
