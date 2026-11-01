/**
 * The deterministic interpreter.
 *
 * This exact function is used twice: by the verifier, which runs it over
 * every possible sequence of events, and by the live runtime, which runs it
 * on real events inside a serializable transaction. What was proved is what
 * runs.
 */
import { sortedDeadlines, type ContractIR, type Literal, type Trigger } from "./ir.js";

export type EvidenceStatus = "none" | "pending" | "accepted" | "rejected";

export interface EvidenceState {
  id: string;
  status: EvidenceStatus;
  /** Deadlines that had not yet passed when this evidence was submitted. */
  before: string[];
}

export interface MachineState {
  activated: boolean;
  closed: boolean;
  /** Deadlines that have passed, in firing order. */
  passed: string[];
  evidence: EvidenceState[];
  /** Clauses that have fired (each fires at most once). */
  fired: string[];
  heldCents: number;
  releasedCents: number;
  refundedCents: number;
}

export type MachineEvent =
  | { type: "activate" }
  | { type: "submit"; evidence: string }
  | { type: "accept"; evidence: string }
  | { type: "reject"; evidence: string }
  | { type: "deadline"; deadline: string }
  /** Consent exit: the funder releases everything still held to the payee. */
  | { type: "release_all" }
  /** Consent exit: the payee gives back everything still held to the funder. */
  | { type: "refund_all" };

export interface Transfer {
  op: "release" | "refund";
  cents: number;
  clauseId: string | null;
}

export interface Fault {
  code: "overdraw";
  clauseId: string;
  requestedCents: number;
  heldCents: number;
}

export interface StepResult {
  state: MachineState;
  transfers: Transfer[];
  firedClauses: string[];
  faults: Fault[];
  closedNow: boolean;
}

export class EventRejected extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EventRejected";
  }
}

export function initialState(ir: ContractIR): MachineState {
  return {
    activated: false,
    closed: false,
    passed: [],
    evidence: ir.evidence.map((e) => ({ id: e.id, status: "none", before: [] })),
    fired: [],
    heldCents: 0,
    releasedCents: 0,
    refundedCents: 0,
  };
}

function cloneState(s: MachineState): MachineState {
  return {
    ...s,
    passed: [...s.passed],
    evidence: s.evidence.map((e) => ({ ...e, before: [...e.before] })),
    fired: [...s.fired],
  };
}

function evidenceState(s: MachineState, id: string): EvidenceState {
  const e = s.evidence.find((x) => x.id === id);
  if (!e) throw new EventRejected("unknown_evidence", `unknown evidence "${id}"`);
  return e;
}

/** The next deadline that will fire, or null when all have passed. */
export function nextDeadline(ir: ContractIR, s: MachineState): string | null {
  const order = sortedDeadlines(ir);
  return s.passed.length < order.length ? order[s.passed.length].id : null;
}

export function submissionWindowOpen(ir: ContractIR, s: MachineState): boolean {
  return s.activated && !s.closed && s.passed.length < ir.deadlines.length;
}

export function evalLiteral(s: MachineState, l: Literal): boolean {
  let v: boolean;
  switch (l.kind) {
    case "submitted":
      v = evidenceState(s, l.evidence!).status !== "none";
      break;
    case "submitted_before": {
      const e = evidenceState(s, l.evidence!);
      v = e.status !== "none" && e.before.includes(l.deadline!);
      break;
    }
    case "accepted":
      v = evidenceState(s, l.evidence!).status === "accepted";
      break;
    case "rejected":
      v = evidenceState(s, l.evidence!).status === "rejected";
      break;
    case "deadline_passed":
      v = s.passed.includes(l.deadline!);
      break;
  }
  return l.negate ? !v : v;
}

export function evalGuard(s: MachineState, guard: Literal[]): boolean {
  return guard.every((l) => evalLiteral(s, l));
}

function matches(trigger: Trigger, ev: MachineEvent): boolean {
  switch (ev.type) {
    case "activate":
      return trigger.on === "activated";
    case "accept":
      return trigger.on === "accepted" && trigger.evidence === ev.evidence;
    case "reject":
      return trigger.on === "rejected" && trigger.evidence === ev.evidence;
    case "deadline":
      return trigger.on === "deadline" && trigger.deadline === ev.deadline;
    default:
      return false;
  }
}

/** Why an event cannot be applied right now, or null if it can. */
export function rejectionReason(ir: ContractIR, s: MachineState, ev: MachineEvent): string | null {
  if (ev.type === "activate") return s.activated ? "already activated" : null;
  if (!s.activated) return "contract is not active yet";
  if (s.closed) return "contract is closed";
  switch (ev.type) {
    case "submit": {
      const e = s.evidence.find((x) => x.id === ev.evidence);
      if (!e) return `unknown evidence "${ev.evidence}"`;
      if (e.status !== "none") return `"${ev.evidence}" was already submitted`;
      if (!submissionWindowOpen(ir, s)) return "the submission window has closed (all deadlines passed)";
      return null;
    }
    case "accept":
    case "reject": {
      const e = s.evidence.find((x) => x.id === ev.evidence);
      if (!e) return `unknown evidence "${ev.evidence}"`;
      return e.status === "pending" ? null : `"${ev.evidence}" is not awaiting a decision`;
    }
    case "deadline": {
      const next = nextDeadline(ir, s);
      if (next === null) return "all deadlines have passed";
      return next === ev.deadline ? null : `deadlines fire in order; next is "${next}"`;
    }
    case "release_all":
    case "refund_all":
      return null;
  }
}

export function canApply(ir: ContractIR, s: MachineState, ev: MachineEvent): boolean {
  return rejectionReason(ir, s, ev) === null;
}

/**
 * Apply one event. Never mutates its input.
 *
 * Order of operations: update evidence/time state, then fire every matching
 * clause (declaration order) whose guard holds, then close if nothing is held.
 * Faults are reported, not thrown: the verifier turns them into
 * counterexamples, the runtime freezes the contract.
 */
export function step(ir: ContractIR, prev: MachineState, ev: MachineEvent): StepResult {
  const reason = rejectionReason(ir, prev, ev);
  if (reason) throw new EventRejected("event_rejected", reason);
  const s = cloneState(prev);
  const transfers: Transfer[] = [];
  const firedClauses: string[] = [];
  const faults: Fault[] = [];

  const move = (op: "release" | "refund", cents: number, clauseId: string | null) => {
    if (cents <= 0) return;
    s.heldCents -= cents;
    if (op === "release") s.releasedCents += cents;
    else s.refundedCents += cents;
    transfers.push({ op, cents, clauseId });
  };

  switch (ev.type) {
    case "activate":
      s.activated = true;
      s.heldCents = ir.principalCents;
      break;
    case "submit": {
      const e = evidenceState(s, ev.evidence);
      e.status = "pending";
      e.before = sortedDeadlines(ir)
        .map((d) => d.id)
        .filter((id) => !s.passed.includes(id));
      break;
    }
    case "accept":
      evidenceState(s, ev.evidence).status = "accepted";
      break;
    case "reject":
      evidenceState(s, ev.evidence).status = "rejected";
      break;
    case "deadline":
      s.passed.push(ev.deadline);
      break;
    case "release_all":
      move("release", s.heldCents, null);
      break;
    case "refund_all":
      move("refund", s.heldCents, null);
      break;
  }

  if (ev.type !== "release_all" && ev.type !== "refund_all") {
    for (const clause of ir.clauses) {
      if (s.fired.includes(clause.id)) continue;
      if (!matches(clause.trigger, ev)) continue;
      if (!evalGuard(s, clause.guard)) continue;
      s.fired.push(clause.id);
      firedClauses.push(clause.id);
      for (const action of clause.actions) {
        const amount = action.remaining ? s.heldCents : (action.cents ?? 0);
        if (amount > s.heldCents) {
          faults.push({ code: "overdraw", clauseId: clause.id, requestedCents: amount, heldCents: s.heldCents });
          continue;
        }
        move(action.op, amount, clause.id);
      }
    }
  }

  let closedNow = false;
  if (s.activated && !s.closed && s.heldCents === 0) {
    s.closed = true;
    closedNow = true;
  }
  return { state: s, transfers, firedClauses, faults, closedNow };
}

/** Events that may legally happen next (used by the verifier). Excludes consent exits. */
export function enabledEvents(ir: ContractIR, s: MachineState): MachineEvent[] {
  if (!s.activated) return [{ type: "activate" }];
  if (s.closed) return [];
  const out: MachineEvent[] = [];
  const next = nextDeadline(ir, s);
  if (next) out.push({ type: "deadline", deadline: next });
  const windowOpen = submissionWindowOpen(ir, s);
  for (const e of s.evidence) {
    if (e.status === "none" && windowOpen) out.push({ type: "submit", evidence: e.id });
    if (e.status === "pending") {
      out.push({ type: "accept", evidence: e.id });
      out.push({ type: "reject", evidence: e.id });
    }
  }
  return out;
}

/** A state from which nothing else can ever happen. */
export function isTerminal(ir: ContractIR, s: MachineState): boolean {
  return s.activated && (s.closed || enabledEvents(ir, s).length === 0);
}
