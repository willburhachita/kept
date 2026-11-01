/**
 * Exhaustive explicit-state model checker.
 *
 * Explores every reachable state of a contract (every order in which
 * deliveries, reviews and deadlines can happen, including "at the same
 * instant" races, which are just two interleavings) using breadth-first
 * search, so every counterexample is a shortest one.
 *
 * Properties:
 *   conservation        money in = money out; no rule pays more than is held
 *   no_stranded_funds   every outcome ends with every cent released or refunded
 *   promise:<id>        each promise (guarantee) holds on every outcome it covers
 *   paypal_window       all money moves inside PayPal's authorization/refund window
 *   no_cutoff           (warning) no settlement while a submission awaits review,
 *                       unless the payee is already paid in full
 */
import { authorizationAmount, feeOnCumulative, formatCents, maxFee } from "./fees.js";
import {
  enabledEvents,
  evalLiteral,
  initialState,
  isTerminal,
  step,
  type Fault,
  type MachineEvent,
  type MachineState,
  type StepResult,
  type Transfer,
} from "./interpreter.js";
import { ENGINE_VERSION, horizonHours, irHash, validateContract, type ContractIR, type Issue } from "./ir.js";
import { describeLiteral, formatHours, narrateEvent, narrateTransfer } from "./render.js";

/** Service levels the runtime enforces. The verifier budgets time with them. */
export const SLA = {
  funderReviewHours: 72,
  disputeWindowHours: 48,
  arbiterHours: 72,
} as const;

/** PayPal facts the verifier encodes (Payments v2). */
export const PAYPAL_RULES = {
  honorPeriodHours: 72,
  authorizationValidHours: 29 * 24,
  /** We plan within 28 days to keep a safety margin before expiry. */
  authorizationBudgetHours: 28 * 24,
  refundWindowHours: 180 * 24,
  escrowBudgetHours: 170 * 24,
} as const;

/** Worst-case time from a submission to a final accept/reject decision. */
export function resolutionBoundHours(challengeWindowHours: number): number {
  return Math.max(
    challengeWindowHours + SLA.arbiterHours,
    SLA.funderReviewHours + SLA.disputeWindowHours + SLA.arbiterHours,
  );
}

export type PropertyStatus = "proved" | "violated";

export interface TraceStep {
  index: number;
  event: MachineEvent;
  narration: string[];
  firedClauses: string[];
  transfers: Transfer[];
  faults: Fault[];
  heldCents: number;
  releasedCents: number;
  refundedCents: number;
  closed: boolean;
}

export interface Counterexample {
  propertyId: string;
  steps: TraceStep[];
  outcome: string;
}

export interface PropertyResult {
  id: string;
  title: string;
  kind: "safety" | "liveness" | "promise" | "rails" | "fairness" | "completeness";
  severity: "error" | "warning";
  status: PropertyStatus;
  detail: string;
  counterexample?: Counterexample;
}

export interface LifecyclePlan {
  fundingMode: ContractIR["fundingMode"];
  principalCents: number;
  maxFeeCents: number;
  authorizationCents: number;
  horizonHours: number;
  resolutionBoundHours: number;
  latestMoneyMovementHours: number;
  captureMayFollowHonorPeriod: boolean;
  steps: string[];
}

/** One distinct way the contract can end, with its shortest example. */
export interface OutcomeSummary {
  id: string;
  payeeCents: number;
  funderCents: number;
  feeCents: number;
  /** Money still held at the end. Non-zero only when no_stranded_funds is violated. */
  stuckCents: number;
  evidence: Record<string, "none" | "pending" | "accepted" | "rejected">;
  settled: boolean;
  description: string;
  example: string[];
}

/** Every number about money and time that can be derived before anything runs. */
export interface Bounds {
  payeeMinCents: number;
  payeeMaxCents: number;
  funderMinCents: number;
  funderMaxCents: number;
  feeMinCents: number;
  feeMaxCents: number;
  /** Most separate releases on any path (= PayPal partial captures + payouts). */
  maxReleaseTransfers: number;
  /** Most separate refunds on any path. */
  maxRefundTransfers: number;
  /** Upper bound on PayPal API calls for the whole contract, funding included. */
  maxPayPalCalls: number;
  /** Earliest hour at which the contract can be fully settled (0 = at funding). */
  earliestSettlementHours: number;
  /** Latest hour by which every cent has moved (worst case, including reviews). */
  latestSettlementHours: number;
  distinctOutcomes: number;
}

export interface VerificationReport {
  ok: boolean;
  engineVersion: string;
  irHash: string;
  feeBps: number;
  summary: string;
  properties: PropertyResult[];
  warnings: Issue[];
  lifecycle: LifecyclePlan;
  outcomes: OutcomeSummary[];
  bounds: Bounds;
  stats: {
    states: number;
    transitions: number;
    terminalStates: number;
    maxDepth: number;
    truncated: boolean;
    ms: number;
  };
}

export interface VerifyOptions {
  feeBps?: number;
  maxStates?: number;
}

interface Node {
  state: MachineState;
  parent: string | null;
  via: MachineEvent | null;
  result: StepResult | null;
  depth: number;
  /** Outgoing transitions (every event adds exactly one unit of progress, so the graph is layered by depth). */
  out: { key: string; releases: number; refunds: number }[];
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function verify(ir: ContractIR, opts: VerifyOptions = {}): VerificationReport {
  const started = now();
  const feeBps = opts.feeBps ?? 0;
  const maxStates = opts.maxStates ?? 100_000;
  const clauseIndex = new Map(ir.clauses.map((c, i) => [c.id, i]));

  const keyOf = (s: MachineState, fault = false): string => {
    let mask = 0;
    for (const id of s.fired) mask |= 1 << (clauseIndex.get(id) ?? 0);
    const ev = s.evidence.map((e) => `${e.status[0]}${e.before.length}`).join(",");
    return `${s.activated ? 1 : 0}${s.closed ? 1 : 0}|${s.passed.length}|${ev}|${mask}|${s.heldCents},${s.releasedCents},${s.refundedCents}${fault ? "|F" : ""}`;
  };

  const nodes = new Map<string, Node>();
  const queue: string[] = [];
  const root = initialState(ir);
  const rootKey = keyOf(root);
  nodes.set(rootKey, { state: root, parent: null, via: null, result: null, depth: 0, out: [] });
  queue.push(rootKey);
  const terminalKeys: string[] = [];

  const firstViolation = new Map<string, { key: string; outcome: string }>();
  const record = (id: string, key: string, outcome: string) => {
    if (!firstViolation.has(id)) firstViolation.set(id, { key, outcome });
  };
  const firedAnywhere = new Set<string>();
  let transitions = 0;
  let terminals = 0;
  let maxDepth = 0;
  let truncated = false;

  const checkTerminal = (key: string, s: MachineState) => {
    if (!s.closed && s.heldCents > 0) {
      record("no_stranded_funds", key, `Nothing else can happen, but ${formatCents(s.heldCents, ir.currency)} is still held. That money would be stuck forever.`);
    }
    const pending = s.evidence.filter((e) => e.status === "pending");
    if (s.closed && pending.length > 0 && s.releasedCents < ir.principalCents) {
      const labels = pending.map((p) => `“${ir.evidence.find((e) => e.id === p.id)?.label ?? p.id}”`).join(", ");
      record("no_cutoff", key, `The contract settled while ${labels} was still waiting for review, and the payee had received only ${formatCents(s.releasedCents, ir.currency)}.`);
    }
    for (const g of ir.guarantees) {
      if (!g.when.every((l) => evalLiteral(s, l))) continue;
      const got = g.party === "payee" ? s.releasedCents : s.refundedCents;
      if (got < g.atLeastCents) {
        const why = g.when.length ? ` This outcome is covered by the promise because ${g.when.map((l) => describeLiteral(ir, l)).join(", ")}.` : "";
        record(
          `promise:${g.id}`,
          key,
          `The ${g.party} should get at least ${formatCents(g.atLeastCents, ir.currency)} here but gets ${formatCents(got, ir.currency)}.${why}`,
        );
      }
    }
  };

  outer: for (let qi = 0; qi < queue.length; qi++) {
    const key = queue[qi];
    const node = nodes.get(key)!;
    const s = node.state;
    maxDepth = Math.max(maxDepth, node.depth);
    if (isTerminal(ir, s)) {
      terminals++;
      terminalKeys.push(key);
      checkTerminal(key, s);
      continue;
    }
    for (const ev of enabledEvents(ir, s)) {
      const res = step(ir, s, ev);
      transitions++;
      for (const c of res.firedClauses) firedAnywhere.add(c);
      const ns = res.state;
      if (res.faults.length > 0) {
        const fk = keyOf(ns, true);
        if (!nodes.has(fk)) nodes.set(fk, { state: ns, parent: key, via: ev, result: res, depth: node.depth + 1, out: [] });
        const f = res.faults[0];
        const rule = ir.clauses.find((c) => c.id === f.clauseId);
        record(
          "conservation",
          fk,
          `Rule “${rule?.label ?? f.clauseId}” tries to move ${formatCents(f.requestedCents, ir.currency)} but only ${formatCents(f.heldCents, ir.currency)} is still held.`,
        );
        continue;
      }
      if (ns.activated && ns.heldCents + ns.releasedCents + ns.refundedCents !== ir.principalCents) {
        const ik = keyOf(ns, true);
        if (!nodes.has(ik)) nodes.set(ik, { state: ns, parent: key, via: ev, result: res, depth: node.depth + 1, out: [] });
        record("conservation", ik, "Money in no longer equals money out.");
        continue;
      }
      const nk = keyOf(ns);
      node.out.push({
        key: nk,
        releases: res.transfers.filter((t) => t.op === "release").length,
        refunds: res.transfers.filter((t) => t.op === "refund").length,
      });
      if (nodes.has(nk)) continue;
      if (nodes.size >= maxStates) {
        truncated = true;
        break outer;
      }
      nodes.set(nk, { state: ns, parent: key, via: ev, result: res, depth: node.depth + 1, out: [] });
      queue.push(nk);
    }
  }

  const traceTo = (key: string): TraceStep[] => {
    const chain: Node[] = [];
    let k: string | null = key;
    while (k) {
      const n: Node = nodes.get(k)!;
      chain.push(n);
      k = n.parent;
    }
    chain.reverse();
    return chain.slice(1).map((n, i) => {
      const r = n.result!;
      return {
        index: i + 1,
        event: n.via!,
        narration: [
          narrateEvent(ir, n.via!, n.state),
          ...r.transfers.map((t) => narrateTransfer(ir, t)),
          ...r.faults.map((f) => {
            const rule = ir.clauses.find((c) => c.id === f.clauseId);
            return `Rule “${rule?.label ?? f.clauseId}” tries to move ${formatCents(f.requestedCents, ir.currency)}, but only ${formatCents(f.heldCents, ir.currency)} is held.`;
          }),
          ...(r.closedNow ? ["Nothing is held anymore, so the contract settles."] : []),
        ],
        firedClauses: r.firedClauses,
        transfers: r.transfers,
        faults: r.faults,
        heldCents: n.state.heldCents,
        releasedCents: n.state.releasedCents,
        refundedCents: n.state.refundedCents,
        closed: n.state.closed,
      };
    });
  };

  const counter = (id: string): Counterexample | undefined => {
    const v = firstViolation.get(id);
    return v ? { propertyId: id, steps: traceTo(v.key), outcome: v.outcome } : undefined;
  };

  // Rails: when can money possibly move?
  const H = horizonHours(ir);
  const R = resolutionBoundHours(ir.challengeWindowHours);
  const timeOf = (c: ContractIR["clauses"][number]): number => {
    if (c.trigger.on === "activated") return 0;
    if (c.trigger.on === "deadline") return ir.deadlines.find((d) => d.id === c.trigger.deadline)?.afterHours ?? H;
    return H + R;
  };
  const moving = ir.clauses.filter((c) => c.actions.length > 0);
  const latest = moving.reduce((m, c) => Math.max(m, timeOf(c)), 0);
  const latestRelease = moving
    .filter((c) => c.actions.some((a) => a.op === "release"))
    .reduce((m, c) => Math.max(m, timeOf(c)), 0);
  const captureAfterHonor = ir.fundingMode === "authorize" && latestRelease > PAYPAL_RULES.honorPeriodHours;
  const budget = ir.fundingMode === "authorize" ? PAYPAL_RULES.authorizationBudgetHours : PAYPAL_RULES.escrowBudgetHours;
  const fee = maxFee(ir.principalCents, feeBps);
  const auth = authorizationAmount(ir.principalCents, feeBps);
  const fmt = (c: number) => formatCents(c, ir.currency);

  const lifecycle: LifecyclePlan = {
    fundingMode: ir.fundingMode,
    principalCents: ir.principalCents,
    maxFeeCents: fee,
    authorizationCents: auth,
    horizonHours: H,
    resolutionBoundHours: R,
    latestMoneyMovementHours: latest,
    captureMayFollowHonorPeriod: captureAfterHonor,
    steps:
      ir.fundingMode === "authorize"
        ? [
            `The funder approves a PayPal authorization of ${fmt(auth)} (${fmt(ir.principalCents)} principal + up to ${fmt(fee)} fee). Nothing is captured yet.`,
            "Each release captures that amount plus its fee from the authorization (a partial capture), then pays the payee with a PayPal Payout.",
            "Refunds are earmarked immediately. The hold for them is released at settlement by voiding the uncaptured remainder.",
            captureAfterHonor
              ? "Some captures can happen after PayPal's 3-day honor period, so the runtime reauthorizes the hold just in time (PayPal allows this from day 4 to day 29)."
              : "Every capture happens inside PayPal's 3-day honor period.",
            `All money moves by hour ${latest} (${formatHours(Math.max(latest, 1))}), inside the 29-day authorization window. The plan budgets 28 days.`,
            "If a review ever runs late, an expiry guard captures the remaining hold into escrow 24 hours before the authorization expires, so nothing is lost.",
          ]
        : [
            `The funder pays ${fmt(auth)} up front. It is captured into escrow at the start.`,
            "Each release is paid to the payee with a PayPal Payout.",
            "Refunds are partial refunds of the original capture, which PayPal allows for 180 days.",
            `All money moves by hour ${latest} (${formatHours(Math.max(latest, 1))}). Unused fee reserve is refunded at settlement.`,
          ],
  };

  // ---- Outcomes and bounds: everything derivable about money and time ----
  const statusWord = { none: "not submitted", pending: "still under review", accepted: "accepted", rejected: "rejected" } as const;
  const outcomeMap = new Map<string, OutcomeSummary>();
  let payeeMin = Infinity;
  let payeeMax = 0;
  let funderMin = Infinity;
  let funderMax = 0;
  let earliest = Infinity;
  for (const key of terminalKeys) {
    const s = nodes.get(key)!.state;
    payeeMin = Math.min(payeeMin, s.releasedCents);
    payeeMax = Math.max(payeeMax, s.releasedCents);
    funderMin = Math.min(funderMin, s.refundedCents);
    funderMax = Math.max(funderMax, s.refundedCents);
    if (s.closed) {
      const lastPassed = s.passed.length ? (ir.deadlines.find((d) => d.id === s.passed[s.passed.length - 1])?.afterHours ?? 0) : 0;
      earliest = Math.min(earliest, lastPassed);
    }
    const sig = `${s.releasedCents}|${s.refundedCents}|${s.heldCents}|${s.evidence.map((e) => e.status).join(",")}`;
    if (outcomeMap.has(sig) || outcomeMap.size >= 64) continue;
    const evidence = Object.fromEntries(s.evidence.map((e) => [e.id, e.status])) as OutcomeSummary["evidence"];
    const evidenceText = s.evidence
      .map((e) => `“${ir.evidence.find((x) => x.id === e.id)?.label ?? e.id}” ${statusWord[e.status]}`)
      .join(", ");
    const money = `payee gets ${fmt(s.releasedCents)}, funder gets back ${fmt(s.refundedCents)}`;
    outcomeMap.set(sig, {
      id: `o${outcomeMap.size + 1}`,
      payeeCents: s.releasedCents,
      funderCents: s.refundedCents,
      feeCents: feeOnCumulative(s.releasedCents, feeBps),
      stuckCents: s.closed ? 0 : s.heldCents,
      evidence,
      settled: s.closed,
      description: `${evidenceText ? `${evidenceText}: ` : ""}${money}${s.closed ? "" : `, ${fmt(s.heldCents)} stuck`}.`,
      example: traceTo(key).flatMap((st) => st.narration),
    });
  }
  // Longest path (by number of transfers) over the layered state graph, deepest layer first.
  const best = new Map<string, { rel: number; ref: number }>();
  for (const key of [...nodes.keys()].sort((a, b) => nodes.get(b)!.depth - nodes.get(a)!.depth)) {
    let rel = 0;
    let ref = 0;
    for (const e of nodes.get(key)!.out) {
      const child = best.get(e.key) ?? { rel: 0, ref: 0 };
      rel = Math.max(rel, e.releases + child.rel);
      ref = Math.max(ref, e.refunds + child.ref);
    }
    best.set(key, { rel, ref });
  }
  const maxRel = best.get(rootKey)?.rel ?? 0;
  const maxRef = best.get(rootKey)?.ref ?? 0;
  const maxPayPalCalls =
    ir.fundingMode === "authorize"
      ? 2 /* create order + authorize */ + maxRel * 3 /* reauthorize + capture + payout */ + 1 /* void */
      : 2 /* create order + capture */ + maxRel /* payouts */ + maxRef + 1 /* refunds + unused fee reserve */;
  const bounds: Bounds = {
    payeeMinCents: Number.isFinite(payeeMin) ? payeeMin : 0,
    payeeMaxCents: payeeMax,
    funderMinCents: Number.isFinite(funderMin) ? funderMin : 0,
    funderMaxCents: funderMax,
    feeMinCents: feeOnCumulative(Number.isFinite(payeeMin) ? payeeMin : 0, feeBps),
    feeMaxCents: feeOnCumulative(payeeMax, feeBps),
    maxReleaseTransfers: maxRel,
    maxRefundTransfers: maxRef,
    maxPayPalCalls,
    earliestSettlementHours: Number.isFinite(earliest) ? earliest : latest,
    latestSettlementHours: latest,
    distinctOutcomes: outcomeMap.size,
  };

  const properties: PropertyResult[] = [];
  const add = (p: Omit<PropertyResult, "status" | "counterexample">) => {
    const ce = counter(p.id);
    properties.push({ ...p, status: ce ? "violated" : "proved", counterexample: ce });
  };
  const explored = `${nodes.size.toLocaleString("en-US")} reachable states`;
  add({
    id: "conservation",
    title: "Every cent is accounted for",
    kind: "safety",
    severity: "error",
    detail: `Across ${explored}, money in always equals money out and no rule ever moves more than is held.`,
  });
  add({
    id: "no_stranded_funds",
    title: "No money gets stuck",
    kind: "liveness",
    severity: "error",
    detail: `All ${terminals.toLocaleString("en-US")} possible endings release or refund every cent.`,
  });
  for (const g of ir.guarantees) {
    add({
      id: `promise:${g.id}`,
      title: g.label,
      kind: "promise",
      severity: "error",
      detail: `Holds on every outcome it covers (checked across ${explored}).`,
    });
  }
  add({
    id: "no_cutoff",
    title: "No review is cut off",
    kind: "fairness",
    severity: "warning",
    detail: "The contract never settles while the payee is waiting on a review, unless they are already paid in full.",
  });

  const windowOk = latest <= budget;
  properties.push({
    id: "paypal_window",
    title: "Fits PayPal's payment lifecycle",
    kind: "rails",
    severity: "error",
    status: windowOk ? "proved" : "violated",
    detail: windowOk
      ? ir.fundingMode === "authorize"
        ? `Latest possible money movement is hour ${latest}, inside the authorization window (budget ${PAYPAL_RULES.authorizationBudgetHours}h of PayPal's 29 days).`
        : `Latest possible money movement is hour ${latest}, inside PayPal's 180-day refund window (budget ${PAYPAL_RULES.escrowBudgetHours}h).`
      : ir.fundingMode === "authorize"
        ? `Money could still need to move at hour ${latest} (last deadline ${H}h + up to ${R}h of review), after the PayPal authorization expires. Use escrow funding or shorten the deadlines.`
        : `Money could still need to move at hour ${latest}, beyond PayPal's refund window. Shorten the deadlines.`,
  });

  if (truncated) {
    properties.push({
      id: "exhaustive",
      title: "Checked every possibility",
      kind: "completeness",
      severity: "error",
      status: "violated",
      detail: `The contract has more than ${maxStates.toLocaleString("en-US")} states, so it could not be checked exhaustively. Simplify it.`,
    });
  }

  const warnings: Issue[] = [];
  for (const c of ir.clauses) {
    if (!truncated && !firedAnywhere.has(c.id)) {
      warnings.push({ code: "dead_clause", path: `$.clauses[${clauseIndex.get(c.id)}]`, message: `Rule “${c.label}” can never fire.`, severity: "warning" });
    }
  }
  const referenced = new Set<string>();
  for (const c of ir.clauses) {
    if (c.trigger.evidence) referenced.add(c.trigger.evidence);
    if (c.trigger.deadline) referenced.add(c.trigger.deadline);
    for (const l of c.guard) {
      if (l.evidence) referenced.add(l.evidence);
      if (l.deadline) referenced.add(l.deadline);
    }
  }
  ir.evidence.forEach((e, i) => {
    if (!referenced.has(e.id)) warnings.push({ code: "unused_evidence", path: `$.evidence[${i}]`, message: `“${e.label}” is never used by any rule.`, severity: "warning" });
  });

  const ok = properties.every((p) => p.status === "proved" || p.severity === "warning");
  const failed = properties.filter((p) => p.status === "violated" && p.severity === "error");
  const proved = properties.filter((p) => p.status === "proved").length;
  const summary = ok
    ? `Proved ${proved} properties across ${explored}.`
    : `${failed.length} propert${failed.length === 1 ? "y" : "ies"} violated: ${failed.map((p) => p.title).join("; ")}.`;

  return {
    ok,
    engineVersion: ENGINE_VERSION,
    irHash: irHash(ir),
    feeBps,
    summary,
    properties,
    warnings,
    lifecycle,
    outcomes: [...outcomeMap.values()],
    bounds,
    stats: {
      states: nodes.size,
      transitions,
      terminalStates: terminals,
      maxDepth,
      truncated,
      ms: Math.round((now() - started) * 100) / 100,
    },
  };
}

export type VerifyInputResult =
  | { valid: true; ir: ContractIR; report: VerificationReport; issues: Issue[] }
  | { valid: false; issues: Issue[] };

/** Validate untrusted input, then verify it. */
export function verifyContract(raw: unknown, opts: VerifyOptions = {}): VerifyInputResult {
  const v = validateContract(raw);
  if (!v.ok) return { valid: false, issues: v.issues };
  return { valid: true, ir: v.value, report: verify(v.value, opts), issues: v.issues };
}

/** Compact, model-friendly description of what failed (used by the repair loop). */
export function violationsForRepair(report: VerificationReport): string {
  const lines: string[] = [];
  for (const p of report.properties) {
    if (p.status !== "violated") continue;
    lines.push(`PROPERTY ${p.id} (${p.severity}): ${p.title}`);
    if (p.counterexample) {
      p.counterexample.steps.forEach((s) => lines.push(`  ${s.index}. ${s.narration.join(" ")}`));
      lines.push(`  RESULT: ${p.counterexample.outcome}`);
    } else lines.push(`  ${p.detail}`);
  }
  return lines.join("\n");
}
