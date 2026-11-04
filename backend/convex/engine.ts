/**
 * The runtime. Applies real events to a contract with the exact interpreter
 * the verifier proved, inside a serializable Convex transaction, and turns
 * each money decision into ledger postings plus outbox effects.
 *
 * Races are resolved by Convex's serializability: a delivery and a deadline
 * that happen "at the same time" are applied in one order or the other, and
 * the verifier already proved both orders safe.
 */
import {
  ENGINE_VERSION,
  PAYPAL_RULES,
  feeForRelease,
  formatCents,
  initialState,
  nextDeadline,
  rejectionReason,
  sortedDeadlines,
  step,
  termsHash as computeTermsHash,
  type MachineEvent,
  type Transfer,
} from "@kept/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { returnStrayFunds } from "./effects";
import { loadContract, requireRole, requireUserId } from "./lib/authz";
import { fail } from "./lib/errors";
import { actorUser, appendJournal, type Actor } from "./lib/journal";
import { postLedger } from "./lib/ledger";
import { notify, notifyStaff } from "./lib/notify";
import { enqueueEffect, findEffectByRef, hasOpenEffects } from "./lib/outbox";

const HOUR = 3_600_000;

function sumCaptured(f: NonNullable<Doc<"contracts">["funding"]>): number {
  return f.captures.reduce((s, c) => s + c.cents, 0);
}

export function eventLabel(ev: MachineEvent): string {
  switch (ev.type) {
    case "submit":
    case "accept":
    case "reject":
      return `${ev.type}:${ev.evidence}`;
    case "deadline":
      return `deadline:${ev.deadline}`;
    default:
      return ev.type;
  }
}

/**
 * Apply one machine event to an active contract. Returns what happened.
 * Callers (evidence decisions, deadlines, consent exits) run inside their own
 * mutation, so the evidence status change and the money decision commit
 * together or not at all.
 */
export async function applyEvent(
  ctx: MutationCtx,
  contractId: Id<"contracts">,
  event: MachineEvent,
  actor: Actor,
): Promise<{ transfers: Transfer[]; fired: string[]; closed: boolean }> {
  const c = await loadContract(ctx, contractId);
  if (c.status !== "active") fail("INVALID_STATE", `Contract is ${c.status}, not active.`);
  if (!c.ir || !c.machine || !c.funding) fail("INVALID_STATE", "Contract has no runtime state.");
  const reason = rejectionReason(c.ir, c.machine, event);
  if (reason) fail("INVALID_STATE", reason);

  const r = step(c.ir, c.machine, event);
  if (r.faults.length > 0) {
    // Unreachable for a verified contract. If it ever happens, stop everything.
    await freezeContract(ctx, c, `Runtime fault on ${eventLabel(event)}: rule ${r.faults[0].clauseId} tried to overdraw.`, "system");
    return { transfers: [], fired: [], closed: false };
  }

  const ledger = { ...c.ledger };
  const now = Date.now();
  const postings: Parameters<typeof postLedger>[2] = [];
  const effects: Parameters<typeof enqueueEffect>[1][] = [];
  const payeeEmail = c.approvals.payee?.payoutEmail;
  const pendingCaptureIndex = c.funding.captures.findIndex((x) => x.status !== undefined && x.status !== "COMPLETED");
  const deferrals: { cents: number; receiverEmail: string; purpose: string }[] = [];
  if (event.type === "activate") {
    ledger.heldCents = c.ir.principalCents;
    postings.push({ kind: "fund", cents: c.ir.principalCents, from: "funder", to: "hold", memo: c.funding.mode });
    postings.push({ kind: "fee_reserve", cents: c.funding.maxFeeCents, from: "funder", to: "fee_reserve" });
  }

  for (const t of r.transfers) {
    if (t.op === "release") {
      const fee = feeForRelease(ledger.releasedCents, t.cents, c.feeBps);
      ledger.heldCents -= t.cents;
      ledger.releasedCents += t.cents;
      ledger.feesCents += fee;
      postings.push({ kind: "release", cents: t.cents, from: "hold", to: "payee", ref: t.clauseId ?? "consent" });
      postings.push({ kind: "fee", cents: fee, from: "fee_reserve", to: "platform", ref: t.clauseId ?? "consent" });
      if (!payeeEmail) {
        await freezeContract(ctx, c, "Payee payout email is missing; cannot release funds.", "system");
        return { transfers: [], fired: [], closed: false };
      }
      if (c.funding.runtimeMode === "authorize") {
        // Also while converting: the capture runs FIFO after the protective capture and turns
        // into a plain payout if the conversion succeeded (see effects.execute).
        effects.push({
          stream: c._id,
          streamKind: "contract",
          kind: "capture_authorization",
          params: { amountCents: t.cents + fee, releaseCents: t.cents, feeCents: fee, purpose: "release", note: c.ir.title },
          ref: t.clauseId ?? "consent",
        });
      } else if (pendingCaptureIndex >= 0) {
        // Escrow funds not cleared yet: park the payout on the pending capture.
        deferrals.push({ cents: t.cents, receiverEmail: payeeEmail, purpose: "release" });
      } else {
        effects.push({
          stream: c._id,
          streamKind: "contract",
          kind: "payout",
          params: { amountCents: t.cents, receiverEmail: payeeEmail, purpose: "release", note: c.ir.title },
          ref: t.clauseId ?? "consent",
        });
      }
    } else {
      ledger.heldCents -= t.cents;
      ledger.refundedCents += t.cents;
      postings.push({ kind: "refund", cents: t.cents, from: "hold", to: "funder", ref: t.clauseId ?? "consent" });
    }
  }

  // Defense in depth: the runtime ledger must mirror the proven machine.
  if (
    ledger.heldCents !== r.state.heldCents ||
    ledger.releasedCents !== r.state.releasedCents ||
    ledger.refundedCents !== r.state.refundedCents
  ) {
    await freezeContract(ctx, c, "Ledger diverged from the contract state machine.", "system");
    return { transfers: [], fired: [], closed: false };
  }

  if (deferrals.length > 0) {
    const captures = c.funding.captures.map((x) => ({ ...x }));
    const cap = captures[pendingCaptureIndex];
    cap.deferredPayouts = [...(cap.deferredPayouts ?? []), ...deferrals];
    await ctx.db.patch(c._id, { funding: { ...c.funding, captures } });
  }
  await ctx.db.patch(c._id, { machine: r.state, ledger, updatedAt: now });
  await postLedger(ctx, c._id, postings);
  await appendJournal(ctx, c._id, actor, "machine.event", {
    event: eventLabel(event),
    firedClauses: r.firedClauses,
    transfers: r.transfers.map((t) => ({ op: t.op, cents: t.cents, clause: t.clauseId })),
    heldCents: r.state.heldCents,
    releasedCents: r.state.releasedCents,
    refundedCents: r.state.refundedCents,
  });
  for (const e of effects) await enqueueEffect(ctx, e);

  if (c.funding.runtimeMode === "escrow" && r.transfers.some((t) => t.op === "refund")) {
    await syncFunderRefunds(ctx, c._id, false);
  }

  for (const t of r.transfers) {
    const amount = formatCents(t.cents, c.ir.currency);
    if (t.op === "release")
      await notify(ctx, c.payeeId, { kind: "money.released", title: `${amount} released to you`, body: c.ir.title, stream: c._id });
    else await notify(ctx, c.funderId, { kind: "money.refunded", title: `${amount} refunded to you`, body: c.ir.title, stream: c._id });
  }
  if (event.type === "deadline") {
    const d = c.ir.deadlines.find((x) => x.id === event.deadline);
    const body = `“${d?.label ?? event.deadline}” passed on ${c.ir.title}.`;
    await notify(ctx, c.funderId, { kind: "deadline.passed", title: "Deadline passed", body, stream: c._id });
    await notify(ctx, c.payeeId, { kind: "deadline.passed", title: "Deadline passed", body, stream: c._id });
  }

  if (r.closedNow) await beginSettlement(ctx, c._id);
  return { transfers: r.transfers, fired: r.firedClauses, closed: r.closedNow };
}

/** Halt a contract. Nothing moves until an arbiter resumes it. */
export async function freezeContract(ctx: MutationCtx, c: Doc<"contracts">, reason: string, by: string): Promise<void> {
  if (c.status === "frozen") return;
  const now = Date.now();
  await ctx.db.patch(c._id, { status: "frozen", frozen: { reason, at: now, by }, updatedAt: now });
  await appendJournal(ctx, c._id, by === "system" ? "system" : (by as Actor), "contract.frozen", { reason, previousStatus: c.status });
  const n = { kind: "contract.frozen", title: "Contract frozen", body: reason, stream: c._id };
  await notify(ctx, c.funderId, n);
  await notify(ctx, c.payeeId, n);
  await notifyStaff(ctx, { ...n, title: "Contract needs an arbiter" });
}

/**
 * Resume a frozen contract (arbiter). Failed money effects are retried (same
 * idempotency keys) and parked effects are released. If PayPal already took
 * funds but the contract never activated, the funds are returned instead.
 */
export async function resumeContract(ctx: MutationCtx, contractId: Id<"contracts">, actor: Actor, note: string): Promise<void> {
  const c = await loadContract(ctx, contractId);
  if (c.status !== "frozen") fail("INVALID_STATE", "Contract is not frozen.");
  const now = Date.now();
  const fundsTaken = Boolean(c.funding?.authorizationId) || (c.funding?.captures.length ?? 0) > 0;
  // Cancelling is final: a cancelled contract frozen later (say, a dispute on a returned checkout) stays cancelled.
  const status = c.cancelledAt ? "cancelled" : c.machine?.closed ? "settling" : c.machine?.activated ? "active" : fundsTaken ? "settling" : "awaiting_funding";
  const effects = await ctx.db
    .query("effects")
    .withIndex("by_stream_seq", (q) => q.eq("stream", c._id))
    .take(500);
  for (const e of effects) {
    if (e.status === "failed" && e.kind !== "reauthorize") await ctx.db.patch(e._id, { status: "pending", attempts: 0, nextAttemptAt: now, updatedAt: now });
    else if (e.status === "pending" && e.nextAttemptAt > now) await ctx.db.patch(e._id, { nextAttemptAt: now, updatedAt: now });
  }
  await ctx.db.patch(c._id, { status, frozen: undefined, updatedAt: now });
  await appendJournal(ctx, c._id, actor, "contract.resumed", { note, status, compensating: !c.machine?.activated && fundsTaken });
  // An earlier resume already queued the compensation; its failed effects were just reset to retry.
  const compensated = effects.some((e) => e.ref === "compensation");
  if (!c.machine?.activated && fundsTaken && c.funding && !compensated) {
    // Never activated: give the money back.
    if (c.funding.authorizationId && c.funding.runtimeMode === "authorize") {
      await enqueueEffect(ctx, { stream: c._id, streamKind: "contract", kind: "void_authorization", params: {}, ref: "compensation" });
    }
    for (const cap of c.funding.captures) {
      const left = cap.cents - cap.refundReservedCents;
      if (left > 0) await enqueueEffect(ctx, { stream: c._id, streamKind: "contract", kind: "refund_capture", params: { captureId: cap.captureId, amountCents: left, note: "Contract did not start" }, ref: "compensation" });
    }
  }
  await ctx.scheduler.runAfter(0, internal.effects.process, { stream: c._id });
  await ctx.scheduler.runAfter(0, internal.engine.fireDueDeadlines, { contractId: c._id });
  if (status === "settling") await checkSettled(ctx, c._id);
}

/** Apply every deadline whose time has come, in order (used before accepting a submission). */
export async function applyOverdueDeadlines(ctx: MutationCtx, contractId: Id<"contracts">): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const c = await ctx.db.get(contractId);
    if (!c || c.status !== "active" || !c.ir || !c.machine || !c.deadlineTimes) return;
    const next = nextDeadline(c.ir, c.machine);
    const at = next ? c.deadlineTimes.find((d) => d.id === next)?.at : undefined;
    if (!next || at === undefined || at > Date.now()) return;
    await applyEvent(ctx, contractId, { type: "deadline", deadline: next }, "system");
  }
}

/**
 * In escrow runtime mode, refunds are executed by partially refunding
 * captures. Allocates what the funder is owed across captures (newest first)
 * and enqueues refund effects. Safe to call repeatedly.
 */
export async function syncFunderRefunds(ctx: MutationCtx, contractId: Id<"contracts">, includeReserve: boolean): Promise<void> {
  const c = await loadContract(ctx, contractId);
  const f = c.funding;
  if (!f || f.runtimeMode !== "escrow") return;
  const reserveLeft = includeReserve ? f.maxFeeCents - c.ledger.feesCents : 0;
  const reserved = f.captures.reduce((s, cap) => s + cap.refundReservedCents, 0);
  let owed = c.ledger.refundedCents + reserveLeft - reserved;
  if (owed <= 0) return;
  const captures = f.captures.map((x) => ({ ...x }));
  const effects: { captureId: string; amountCents: number }[] = [];
  for (let i = captures.length - 1; i >= 0 && owed > 0; i--) {
    const cap = captures[i];
    const available = cap.cents - cap.refundReservedCents;
    if (available <= 0) continue;
    const take = Math.min(available, owed);
    cap.refundReservedCents += take;
    owed -= take;
    effects.push({ captureId: cap.captureId, amountCents: take });
  }
  await ctx.db.patch(c._id, { funding: { ...f, captures }, updatedAt: Date.now() });
  for (const e of effects) {
    await enqueueEffect(ctx, {
      stream: c._id,
      streamKind: "contract",
      kind: "refund_capture",
      params: { captureId: e.captureId, amountCents: e.amountCents, note: c.ir?.title },
      ref: "refund",
    });
  }
}

/** Nothing is held anymore: release or refund what PayPal still holds. */
export async function beginSettlement(ctx: MutationCtx, contractId: Id<"contracts">): Promise<void> {
  const c = await loadContract(ctx, contractId);
  if (!c.funding) return;
  await ctx.db.patch(c._id, { status: "settling", updatedAt: Date.now() });
  const f = c.funding;
  if (f.runtimeMode === "authorize") {
    // Every release captured release + fee, so whatever else is authorized gets voided.
    const remainder = f.authorizationCents - (c.ledger.releasedCents + c.ledger.feesCents);
    if (remainder > 0) {
      await enqueueEffect(ctx, { stream: c._id, streamKind: "contract", kind: "void_authorization", params: {}, ref: "settlement" });
    }
  } else {
    await syncFunderRefunds(ctx, c._id, true);
  }
  await appendJournal(ctx, c._id, "system", "contract.settling", {
    releasedCents: c.ledger.releasedCents,
    refundedCents: c.ledger.refundedCents,
    feesCents: c.ledger.feesCents,
  });
  await checkSettled(ctx, c._id);
}

/** Mark settled once every PayPal effect has finished. */
export async function checkSettled(ctx: MutationCtx, contractId: Id<"contracts">): Promise<void> {
  const c = await ctx.db.get(contractId);
  if (!c || c.status !== "settling") return;
  if (await hasOpenEffects(ctx, c._id)) return;
  // A failed money effect or a payout parked behind a PENDING capture means not settled yet.
  if (c.funding?.captures.some((x) => (x.deferredPayouts?.length ?? 0) > 0)) return;
  const failed = await ctx.db
    .query("effects")
    .withIndex("by_stream_seq", (q) => q.eq("stream", c._id))
    .filter((q) => q.and(q.eq(q.field("status"), "failed"), q.neq(q.field("kind"), "reauthorize")))
    .first();
  if (failed) return;
  const now = Date.now();
  await ctx.db.patch(c._id, { status: "settled", settledAt: now, updatedAt: now });
  await appendJournal(ctx, c._id, "system", "contract.settled", { ledger: c.ledger });
  const n = { kind: "contract.settled", title: "Contract settled", body: c.ir?.title ?? "", stream: c._id };
  await notify(ctx, c.funderId, n);
  await notify(ctx, c.payeeId, n);
}

/**
 * Called by funding once PayPal confirms the authorization or capture. Idempotent.
 * Money that arrives on a checkout the contract no longer waits for (reset or
 * replaced, or the contract cancelled while PayPal was working) is returned
 * instead: `returned: true`.
 */
export const activate = internalMutation({
  args: {
    contractId: v.id("contracts"),
    orderId: v.string(),
    authorizationId: v.optional(v.string()),
    captureId: v.optional(v.string()),
    paypalStatus: v.string(),
    amountCents: v.number(),
    currency: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const c = await loadContract(ctx, a.contractId);
    const isCurrent = c.funding?.orderId === a.orderId;
    const isAbandoned = c.funding?.abandonedOrderIds?.includes(a.orderId) ?? false;
    // Never keep or refund money on an order this contract did not create.
    if (!isCurrent && !isAbandoned) fail("CONFLICT", "PayPal order does not belong to this contract.");
    if (!isCurrent || c.status === "cancelled" || c.status === "awaiting_funding") {
      await returnStrayFunds(ctx, {
        stream: c._id,
        streamKind: "contract",
        authorizationId: a.authorizationId,
        captureId: a.captureId,
        amountCents: a.amountCents,
        reason: isCurrent ? `Contract is ${c.status}` : "The PayPal checkout was closed",
      });
      return { status: c.status, returned: true };
    }
    if (c.status === "active" || c.status === "settling" || c.status === "settled") return { status: c.status };
    if (c.status !== "funding" || !c.funding || !c.ir) fail("INVALID_STATE", `Contract is ${c.status}, not funding.`);
    const now = Date.now();

    // Re-check the approval chain at the moment money becomes committed.
    const expectedTerms =
      c.irHash && c.funderId && c.payeeId
        ? computeTermsHash({ irHash: c.irHash, funderId: c.funderId, payeeId: c.payeeId, feeBps: c.feeBps, engineVersion: ENGINE_VERSION })
        : null;
    const approvalsOk =
      expectedTerms !== null &&
      c.termsHash === expectedTerms &&
      c.approvals.funder?.termsHash === expectedTerms &&
      c.approvals.payee?.termsHash === expectedTerms &&
      c.verification?.ok === true &&
      c.verification.irHash === c.irHash;
    const amountOk = a.amountCents === c.funding.authorizationCents && a.currency === c.funding.currency;

    if (c.funding.mode === "escrow" && a.paypalStatus !== "COMPLETED") {
      // Funds have not cleared (eCheck, review): do not start the contract or pay anyone yet.
      if (!a.captureId) fail("INVALID_ARGUMENT", "captureId required.");
      await ctx.db.patch(c._id, {
        funding: { ...c.funding, pendingCapture: { captureId: a.captureId, amountCents: a.amountCents, currency: a.currency, at: now } },
        updatedAt: now,
      });
      await appendJournal(ctx, c._id, "paypal", "paypal.capture_pending", { orderId: a.orderId, captureId: a.captureId, amountCents: a.amountCents, status: a.paypalStatus });
      await notify(ctx, c.funderId, {
        kind: "funding.pending",
        title: "Payment pending at PayPal",
        body: "The contract starts as soon as PayPal confirms your payment has cleared.",
        stream: c._id,
      });
      return { status: "funding" as const, pending: true };
    }
    const funding = { ...c.funding, pendingCapture: undefined };
    if (c.funding.mode === "authorize") {
      if (!a.authorizationId) fail("INVALID_ARGUMENT", "authorizationId required.");
      funding.authorizationId = a.authorizationId;
      funding.authorizedAt = now;
      funding.honorEndsAt = now + PAYPAL_RULES.honorPeriodHours * HOUR;
      funding.expiresAt = a.expiresAt ?? now + PAYPAL_RULES.authorizationValidHours * HOUR;
    } else {
      if (!a.captureId) fail("INVALID_ARGUMENT", "captureId required.");
      funding.captures = [
        { captureId: a.captureId, cents: a.amountCents, refundReservedCents: 0, refundedCents: 0, purpose: "escrow", at: now, status: a.paypalStatus },
      ];
    }
    const ledger = { ...c.ledger, capturedCents: c.funding.mode === "escrow" ? a.amountCents : 0 };
    await ctx.db.patch(c._id, { funding, ledger, updatedAt: now });
    await appendJournal(ctx, c._id, "paypal", c.funding.mode === "authorize" ? "paypal.authorized" : "paypal.captured", {
      orderId: a.orderId,
      authorizationId: a.authorizationId ?? null,
      captureId: a.captureId ?? null,
      amountCents: a.amountCents,
      currency: a.currency,
      status: a.paypalStatus,
    });

    if (!approvalsOk || !amountOk) {
      const fresh = await loadContract(ctx, c._id);
      await freezeContract(
        ctx,
        fresh,
        !amountOk
          ? `Funded amount ${a.amountCents} ${a.currency} does not match the expected ${c.funding.authorizationCents} ${c.funding.currency}.`
          : "Approvals or verification no longer match the terms at funding time.",
        "system",
      );
      return { status: "frozen" as const };
    }

    const deadlineTimes = sortedDeadlines(c.ir).map((d) => ({ id: d.id, at: now + d.afterHours * HOUR }));
    await ctx.db.patch(c._id, {
      status: "active",
      activatedAt: now,
      deadlineTimes,
      machine: initialState(c.ir),
      updatedAt: now,
    });
    for (const at of new Set(deadlineTimes.map((d) => d.at))) {
      await ctx.scheduler.runAt(at, internal.engine.fireDueDeadlines, { contractId: c._id });
    }
    await appendJournal(ctx, c._id, "system", "contract.activated", { activatedAt: now, deadlines: deadlineTimes });
    const n = { kind: "contract.activated", title: "Contract is live", body: c.ir.title, stream: c._id };
    await notify(ctx, c.funderId, n);
    await notify(ctx, c.payeeId, n);
    await applyEvent(ctx, c._id, { type: "activate" }, "system");
    const after = await ctx.db.get(c._id);
    return { status: after?.status ?? "active" };
  },
});

/** Fire every deadline that is due, in order. Scheduled at each deadline and swept by cron. */
export const fireDueDeadlines = internalMutation({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }) => {
    for (let i = 0; i < 12; i++) {
      const c = await ctx.db.get(contractId);
      if (!c || c.status !== "active" || !c.ir || !c.machine || !c.deadlineTimes) return;
      const next = nextDeadline(c.ir, c.machine);
      if (!next) return;
      const at = c.deadlineTimes.find((d) => d.id === next)?.at;
      if (at === undefined || at > Date.now()) return;
      await applyEvent(ctx, contractId, { type: "deadline", deadline: next }, "system");
    }
  },
});

/** Safety net for missed schedules: every minute, fire anything overdue. */
export const sweepDeadlines = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const active = await ctx.db
      .query("contracts")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(500);
    for (const c of active) {
      if (!c.ir || !c.machine || !c.deadlineTimes) continue;
      const next = nextDeadline(c.ir, c.machine);
      const at = next ? c.deadlineTimes.find((d) => d.id === next)?.at : undefined;
      if (at !== undefined && at <= now - 30_000) await ctx.scheduler.runAfter(0, internal.engine.fireDueDeadlines, { contractId: c._id });
    }
  },
});

/**
 * Expiry guard. An authorization that might expire while money can still
 * move is captured into escrow 24 hours before it expires. Runs every 15 min.
 */
export const authorizationMaintenance = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const candidates = [
      ...(await ctx.db.query("contracts").withIndex("by_status", (q) => q.eq("status", "active")).take(500)),
      ...(await ctx.db.query("contracts").withIndex("by_status", (q) => q.eq("status", "frozen")).take(200)),
      ...(await ctx.db.query("contracts").withIndex("by_status", (q) => q.eq("status", "settling")).take(200)),
    ];
    for (const c of candidates) {
      const f = c.funding;
      // A voided hold has nothing left to capture (the capture would only fail).
      if (!f || f.runtimeMode !== "authorize" || f.converting || f.voided || !f.expiresAt || !c.machine?.activated) continue;
      if (f.expiresAt - now > 24 * HOUR) continue;
      if (f.authorizationCents - sumCaptured(f) <= 0) continue;
      // Settling contracts only need protection while captures are still queued; the void handles the rest.
      if (c.status === "settling" && c.ledger.releasedCents + c.ledger.feesCents <= sumCaptured(f)) continue;
      // One attempt per contract: fail() resets `converting`, so without this a failed protective
      // capture would be re-enqueued every run. It waits for an arbiter instead (resume retries it).
      if (await findEffectByRef(ctx, c._id, "expiry_guard")) continue;
      // runtimeMode flips to escrow only when the protective capture succeeds (effects.ts).
      await ctx.db.patch(c._id, { funding: { ...f, converting: true }, updatedAt: now });
      await enqueueEffect(ctx, { stream: c._id, streamKind: "contract", kind: "protective_capture", params: {}, ref: "expiry_guard" });
      await appendJournal(ctx, c._id, "system", "funding.protective_capture", {
        reason: "authorization expires within 24 hours while the contract is still running",
        expiresAt: f.expiresAt,
      });
    }
  },
});

/**
 * Consent exits, outside the proof by design: the funder can always release
 * everything still held to the payee, and the payee can always hand
 * everything back. Each only gives away the caller's own claim.
 */
export const consentExit = mutation({
  args: { contractId: v.id("contracts"), kind: v.union(v.literal("release_all"), v.literal("refund_all")) },
  handler: async (ctx, { contractId, kind }) => {
    const userId = await requireUserId(ctx);
    const c = await loadContract(ctx, contractId);
    requireRole(c, userId, [kind === "release_all" ? "funder" : "payee"]);
    return await applyEvent(ctx, contractId, { type: kind }, actorUser(userId));
  },
});
