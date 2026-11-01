/**
 * Effect processor: executes outbox effects against the payment rail.
 *
 * Guarantees:
 *  - strictly one effect in flight per stream, in enqueue order
 *  - every PayPal call carries a stable idempotency key derived from the
 *    effect id, so retries (timeouts, crashes, reaper) never move money twice
 *  - retryable failures back off exponentially; permanent failures freeze
 *    the contract for an arbiter instead of guessing (a failed stray return
 *    only alerts staff: that money was never the stream's)
 */
import { formatCents, PAYPAL_RULES, type Currency } from "@kept/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { checkSettled, freezeContract, syncFunderRefunds } from "./engine";
import { maskEmail } from "./lib/authz";
import { env } from "./lib/env";
import { fail as failWith } from "./lib/errors";
import { appendJournal } from "./lib/journal";
import { postLedger } from "./lib/ledger";
import { notify, notifyStaff } from "./lib/notify";
import {
  enqueueEffect,
  findEffectByRef,
  hasOpenEffects,
  type CaptureParams,
  type PayoutParams,
  type RefundParams,
  type VoidParams,
} from "./lib/outbox";
import { getRail, RailError, toRailError } from "./rails";

const HOUR = 3_600_000;
const STUCK_MS = 3 * 60_000;
const MAX_ATTEMPTS = 8;
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000, 3_600_000, 7_200_000];

interface StreamContext {
  streamKind: "contract" | "mandate";
  runtimeMode: "authorize" | "escrow";
  currency: string;
  authorizationId: string | null;
  authorizedAt: number | null;
  honorEndsAt: number | null;
  uncapturedCents: number;
  payeeEmail: string | null;
  title: string;
}

/**
 * Context for executing an effect, or null when the stream may not move money right now.
 * Every other status may run: stray returns (returnStrayFunds) execute on cancelled,
 * awaiting_funding or funding contracts and revoked, awaiting_funding or funding
 * mandates, whose funding _beginOrder already initialized.
 */
async function streamContext(ctx: MutationCtx, e: Doc<"effects">): Promise<StreamContext | null> {
  if (e.streamKind === "contract") {
    const id = ctx.db.normalizeId("contracts", e.stream);
    const c = id ? await ctx.db.get(id) : null;
    // A frozen contract moves nothing, except the protective capture that saves an expiring hold.
    if (!c || !c.funding || (c.status === "frozen" && e.kind !== "protective_capture")) return null;
    const f = c.funding;
    return {
      streamKind: "contract",
      runtimeMode: f.runtimeMode,
      currency: f.currency,
      authorizationId: f.authorizationId ?? null,
      authorizedAt: f.authorizedAt ?? null,
      honorEndsAt: f.honorEndsAt ?? null,
      uncapturedCents: f.authorizationCents - f.captures.reduce((s, x) => s + x.cents, 0),
      payeeEmail: c.approvals.payee?.payoutEmail ?? null,
      title: c.ir?.title ?? "Contract",
    };
  }
  const id = ctx.db.normalizeId("mandates", e.stream);
  const m = id ? await ctx.db.get(id) : null;
  if (!m || !m.funding || m.status === "frozen") return null;
  const f = m.funding;
  return {
    streamKind: "mandate",
    runtimeMode: f.runtimeMode,
    currency: f.currency,
    authorizationId: f.authorizationId ?? null,
    authorizedAt: f.authorizedAt ?? null,
    honorEndsAt: f.honorEndsAt ?? null,
    uncapturedCents: f.authorizationCents - f.captures.reduce((s, x) => s + x.cents, 0),
    payeeEmail: null,
    title: m.policy.title,
  };
}

/** Claim the next effect of a stream (or retry a stuck one). */
export const claimNext = internalMutation({
  args: { stream: v.string() },
  handler: async (ctx, { stream }) => {
    const now = Date.now();
    const inFlight = await ctx.db
      .query("effects")
      .withIndex("by_stream_seq", (q) => q.eq("stream", stream))
      .filter((q) => q.eq(q.field("status"), "in_flight"))
      .first();
    let effect: Doc<"effects"> | null = null;
    if (inFlight) {
      if (now - inFlight.updatedAt < STUCK_MS) return null;
      effect = inFlight; // crashed mid-call: retry with the same idempotency key
    } else {
      effect = await ctx.db
        .query("effects")
        .withIndex("by_stream_seq", (q) => q.eq("stream", stream))
        .filter((q) => q.eq(q.field("status"), "pending"))
        .first();
      if (!effect) return null;
    }
    let context = await streamContext(ctx, effect);
    if (!context && effect.status === "pending") {
      // Frozen: a queued protective capture may still run ahead of everything else, even
      // while the head is parked or backing off (it must not wait past the hold's expiry).
      const protective = await ctx.db
        .query("effects")
        .withIndex("by_stream_seq", (q) => q.eq("stream", stream))
        .filter((q) => q.and(q.eq(q.field("status"), "pending"), q.eq(q.field("kind"), "protective_capture")))
        .first();
      const pc = protective && protective.nextAttemptAt <= now ? await streamContext(ctx, protective) : null;
      if (protective && pc) {
        effect = protective;
        context = pc;
      } else {
        // Park the head effect out of the reaper's way; resume resets it.
        if (effect.nextAttemptAt <= now) await ctx.db.patch(effect._id, { nextAttemptAt: now + 24 * HOUR, updatedAt: now });
        return null;
      }
    } else if (effect.status === "pending" && effect.nextAttemptAt > now) {
      await ctx.scheduler.runAt(effect.nextAttemptAt, internal.effects.process, { stream });
      return null;
    }
    if (!context) return null;
    await ctx.db.patch(effect._id, { status: "in_flight", attempts: effect.attempts + 1, updatedAt: now });
    return { effect: { ...effect, attempts: effect.attempts + 1 }, context };
  },
});

async function execute(effect: Doc<"effects">, c: StreamContext): Promise<Record<string, unknown>> {
  const rail = getRail();
  const key = (prefix: string) => `${prefix}-${effect._id}`;
  const now = Date.now();
  switch (effect.kind) {
    case "capture_authorization":
    case "protective_capture": {
      // The expiry guard already captured everything into escrow: this release is a plain payout now.
      if (effect.kind === "capture_authorization" && c.runtimeMode === "escrow") return { skipped: true, escrowed: true, amountCents: 0 };
      if (!c.authorizationId) throw new RailError("No authorization to capture from", { retryable: false, code: "NO_AUTHORIZATION" });
      const amountCents = effect.kind === "protective_capture" ? c.uncapturedCents : (effect.params as CaptureParams).amountCents;
      if (amountCents <= 0) return { skipped: true, amountCents: 0 };
      let authorizationId = c.authorizationId;
      let reauth: { authorizationId: string; expiresAt: number | null } | null = null;
      let reauthError: string | null = null;
      // Just-in-time reauthorization after PayPal's 3-day honor period (allowed days 4-29).
      const inWindow = c.authorizedAt !== null && now < c.authorizedAt + PAYPAL_RULES.authorizationValidHours * HOUR - HOUR;
      if (c.honorEndsAt !== null && now > c.honorEndsAt && inWindow && c.uncapturedCents > 0) {
        try {
          const r = await rail.reauthorize({ authorizationId, amountCents: c.uncapturedCents, currency: c.currency, requestId: key("reauth") });
          reauth = { authorizationId: r.authorizationId, expiresAt: r.expiresAt };
          authorizationId = r.authorizationId;
        } catch (e) {
          reauthError = toRailError(e).message.slice(0, 300); // proceed with the original authorization
        }
      }
      const cap = await rail.captureAuthorization({
        authorizationId,
        amountCents,
        currency: c.currency,
        finalCapture: effect.kind === "protective_capture",
        invoiceId: `${effect.stream}-${effect.seq}`,
        noteToPayer: effect.kind === "capture_authorization" ? (effect.params as CaptureParams).note : `${c.title}: secured before authorization expiry`,
        requestId: key("cap"),
      });
      if (cap.status === "DECLINED" || cap.status === "FAILED") {
        throw new RailError(`Capture ${cap.status}`, { retryable: false, code: `CAPTURE_${cap.status}` });
      }
      return {
        captureId: cap.captureId,
        status: cap.status,
        amountCents: cap.amountCents || amountCents,
        reauthorizationId: reauth?.authorizationId ?? null,
        reauthExpiresAt: reauth?.expiresAt ?? null,
        reauthError,
      };
    }
    case "payout": {
      const p = effect.params as PayoutParams;
      const r = await rail.payout({
        senderBatchId: key("po"),
        senderItemId: `${effect.stream}-${effect.seq}`,
        receiverEmail: p.receiverEmail,
        amountCents: p.amountCents,
        currency: c.currency,
        note: p.note ?? c.title,
        subject: `${env.brandName()}: you've been paid`,
        requestId: key("po"),
      });
      return { payoutBatchId: r.payoutBatchId, status: r.status, amountCents: p.amountCents };
    }
    case "void_authorization": {
      const p = effect.params as VoidParams;
      if (p.authorizationId) {
        // A stray authorization (returnStrayFunds), not the stream's own hold.
        const r = await rail.voidAuthorization({ authorizationId: p.authorizationId, requestId: key("void") });
        return { status: r.status, authorizationId: p.authorizationId, amountCents: p.amountCents ?? 0 };
      }
      // Nothing left on the hold (fully captured): voiding would fail, and there is nothing to release.
      if (!c.authorizationId || c.uncapturedCents <= 0 || c.runtimeMode === "escrow") return { skipped: true, uncapturedCents: 0 };
      const r = await rail.voidAuthorization({ authorizationId: c.authorizationId, requestId: key("void") });
      return { status: r.status, uncapturedCents: c.uncapturedCents };
    }
    case "refund_capture": {
      const p = effect.params as RefundParams;
      const r = await rail.refundCapture({
        captureId: p.captureId,
        amountCents: p.amountCents,
        currency: c.currency,
        note: p.note ?? c.title,
        invoiceId: `${effect.stream}-${effect.seq}`,
        requestId: key("refund"),
      });
      return { refundId: r.refundId, status: r.status, amountCents: p.amountCents, captureId: p.captureId };
    }
    case "reauthorize": {
      if (!c.authorizationId) return { skipped: true };
      const r = await rail.reauthorize({ authorizationId: c.authorizationId, amountCents: c.uncapturedCents, currency: c.currency, requestId: key("reauth") });
      return { reauthorizationId: r.authorizationId, reauthExpiresAt: r.expiresAt, status: r.status };
    }
  }
}

/** Run the head of a stream's queue. Scheduled on enqueue, completion, retry and by the reaper. */
export const process = internalAction({
  args: { stream: v.string() },
  handler: async (ctx, { stream }) => {
    const claim = await ctx.runMutation(internal.effects.claimNext, { stream });
    if (!claim) return;
    try {
      const result = await execute(claim.effect, claim.context);
      await ctx.runMutation(internal.effects.complete, { effectId: claim.effect._id, result });
    } catch (err) {
      const e = toRailError(err);
      await ctx.runMutation(internal.effects.fail, {
        effectId: claim.effect._id,
        error: e.message.slice(0, 1000),
        retryable: e.retryable,
        code: e.code,
      });
    }
  },
});

type Result = Record<string, any>;

async function applyReauth(f: NonNullable<Doc<"contracts">["funding"]>, r: Result, now: number) {
  if (typeof r.reauthorizationId === "string" && r.reauthorizationId) {
    f.authorizationId = r.reauthorizationId;
    f.honorEndsAt = now + PAYPAL_RULES.honorPeriodHours * HOUR;
    f.reauthorizedAt = now;
  }
}

function isStray(e: Doc<"effects">): boolean {
  return (e.params as { stray?: boolean } | null)?.stray === true;
}

/** A stray authorization was voided or a stray capture refunded: journal it and tell the payer. Nothing else changes. */
async function strayReturned(ctx: MutationCtx, e: Doc<"effects">, payerId: Id<"users"> | undefined, title: string, currency: Currency): Promise<void> {
  const p = e.params as VoidParams & Partial<RefundParams>;
  const amountCents = p.amountCents ?? 0;
  const returned = e.kind === "void_authorization" ? { authorizationId: p.authorizationId ?? null } : { captureId: p.captureId ?? null };
  await appendJournal(ctx, e.stream, "paypal", "paypal.stray_returned", { ...returned, amountCents });
  await notify(ctx, payerId, { kind: "funds.returned", title: `${formatCents(amountCents, currency)} returned to your PayPal`, body: title, stream: e.stream });
}

async function onContractSuccess(ctx: MutationCtx, e: Doc<"effects">, r: Result): Promise<void> {
  const id = ctx.db.normalizeId("contracts", e.stream);
  const c = id ? await ctx.db.get(id) : null;
  if (!c || !c.funding) return;
  if (isStray(e)) {
    await strayReturned(ctx, e, c.funderId, c.ir?.title ?? "", c.funding.currency);
    if (c.status === "settling") await checkSettled(ctx, c._id);
    return;
  }
  const now = Date.now();
  const f = { ...c.funding, captures: c.funding.captures.map((x) => ({ ...x })) };
  const L = { ...c.ledger };
  const currency = f.currency;
  const fmt = (n: number) => formatCents(n, currency);
  switch (e.kind) {
    case "capture_authorization": {
      const p = e.params as CaptureParams;
      const payeeEmail = c.approvals.payee?.payoutEmail ?? "";
      await applyReauth(f, r, now);
      if (r.escrowed) {
        // Funds were already captured by the protective capture: pay out (or park behind it if still PENDING).
        const pendingIdx = f.captures.findIndex((x) => x.status !== undefined && x.status !== "COMPLETED");
        if (pendingIdx >= 0) {
          f.captures[pendingIdx].deferredPayouts = [...(f.captures[pendingIdx].deferredPayouts ?? []), { cents: p.releaseCents, receiverEmail: payeeEmail, purpose: "release" }];
          await ctx.db.patch(c._id, { funding: f, updatedAt: now });
        } else {
          await enqueueEffect(ctx, {
            stream: e.stream,
            streamKind: "contract",
            kind: "payout",
            params: { amountCents: p.releaseCents, receiverEmail: payeeEmail, purpose: "release", note: p.note },
            ref: e._id,
          });
        }
        break;
      }
      if (r.skipped) break;
      const completed = r.status === "COMPLETED";
      f.captures.push({
        captureId: r.captureId,
        cents: r.amountCents,
        refundReservedCents: 0,
        refundedCents: 0,
        purpose: "release",
        at: now,
        status: r.status,
        ...(completed ? {} : { deferredPayouts: [{ cents: p.releaseCents, receiverEmail: payeeEmail, purpose: "release" }] }),
      });
      L.capturedCents += r.amountCents;
      await ctx.db.patch(c._id, { funding: f, ledger: L, updatedAt: now });
      await postLedger(ctx, e.stream, [{ kind: "paypal_capture", cents: r.amountCents, from: "funder", to: "paypal:captured", ref: r.captureId }]);
      await appendJournal(ctx, e.stream, "paypal", "paypal.captured", {
        captureId: r.captureId,
        amountCents: r.amountCents,
        status: r.status,
        effect: e._id,
        reauthorized: Boolean(r.reauthorizationId),
        reauthError: r.reauthError ?? null,
      });
      if (completed) {
        await enqueueEffect(ctx, {
          stream: e.stream,
          streamKind: "contract",
          kind: "payout",
          params: { amountCents: p.releaseCents, receiverEmail: payeeEmail, purpose: "release", note: p.note },
          ref: e._id,
        });
      }
      break;
    }
    case "protective_capture": {
      f.converting = false;
      f.runtimeMode = "escrow"; // only now: everything left is captured into escrow
      if (!r.skipped) {
        f.captures.push({ captureId: r.captureId, cents: r.amountCents, refundReservedCents: 0, refundedCents: 0, purpose: "protective", at: now, status: r.status });
        L.capturedCents += r.amountCents;
      }
      await applyReauth(f, r, now);
      await ctx.db.patch(c._id, { funding: f, ledger: L, updatedAt: now });
      await appendJournal(ctx, e.stream, "paypal", "paypal.protective_captured", { captureId: r.captureId ?? null, amountCents: r.amountCents ?? 0 });
      // Once the machine has closed (settling, or frozen after closing) the unused fee reserve goes back too.
      await syncFunderRefunds(ctx, c._id, c.machine?.closed === true);
      break;
    }
    case "payout": {
      const p = e.params as PayoutParams;
      L.paidOutCents += p.amountCents;
      await ctx.db.patch(c._id, { ledger: L, updatedAt: now });
      await postLedger(ctx, e.stream, [{ kind: "paypal_payout", cents: p.amountCents, from: "paypal:captured", to: "paypal:paid_out", ref: r.payoutBatchId }]);
      await appendJournal(ctx, e.stream, "paypal", "paypal.payout_sent", {
        payoutBatchId: r.payoutBatchId,
        status: r.status,
        amountCents: p.amountCents,
        receiver: maskEmail(p.receiverEmail),
      });
      await notify(ctx, c.payeeId, { kind: "payout.sent", title: `${fmt(p.amountCents)} sent to your PayPal`, body: c.ir?.title ?? "", stream: c._id });
      break;
    }
    case "void_authorization": {
      if (r.skipped) break;
      const voided = f.authorizationCents - f.captures.reduce((s, x) => s + x.cents, 0);
      f.voided = { cents: voided, at: now };
      L.voidedCents = voided;
      await ctx.db.patch(c._id, { funding: f, ledger: L, updatedAt: now });
      await postLedger(ctx, e.stream, [{ kind: "paypal_void", cents: voided, from: "funder", to: "paypal:voided" }]);
      await appendJournal(ctx, e.stream, "paypal", "paypal.voided", { authorizationId: f.authorizationId ?? null, releasedHoldCents: voided });
      await notify(ctx, c.funderId, { kind: "hold.released", title: `${fmt(voided)} hold released on your PayPal`, body: c.ir?.title ?? "", stream: c._id });
      break;
    }
    case "refund_capture": {
      const p = e.params as RefundParams;
      const cap = f.captures.find((x) => x.captureId === p.captureId);
      if (cap) cap.refundedCents += p.amountCents;
      L.refundExecutedCents += p.amountCents;
      await ctx.db.patch(c._id, { funding: f, ledger: L, updatedAt: now });
      await postLedger(ctx, e.stream, [{ kind: "paypal_refund", cents: p.amountCents, from: "paypal:captured", to: "paypal:refunded", ref: r.refundId }]);
      await appendJournal(ctx, e.stream, "paypal", "paypal.refunded", { refundId: r.refundId, captureId: p.captureId, amountCents: p.amountCents });
      await notify(ctx, c.funderId, { kind: "refund.sent", title: `${fmt(p.amountCents)} refunded to your PayPal`, body: c.ir?.title ?? "", stream: c._id });
      break;
    }
    case "reauthorize": {
      await applyReauth(f, r, now);
      await ctx.db.patch(c._id, { funding: f, updatedAt: now });
      await appendJournal(ctx, e.stream, "paypal", "paypal.reauthorized", { authorizationId: f.authorizationId ?? null });
      break;
    }
  }
  const fresh = await ctx.db.get(c._id);
  if (fresh?.status === "settling") await checkSettled(ctx, c._id);
}

async function onMandateSuccess(ctx: MutationCtx, e: Doc<"effects">, r: Result): Promise<void> {
  const id = ctx.db.normalizeId("mandates", e.stream);
  const m = id ? await ctx.db.get(id) : null;
  if (!m || !m.funding) return;
  if (isStray(e)) {
    // Not this mandate's budget: a stray void never closes the mandate.
    await strayReturned(ctx, e, m.ownerId, m.policy.title, m.funding.currency);
    return;
  }
  const now = Date.now();
  const f = { ...m.funding, captures: m.funding.captures.map((x) => ({ ...x })) };
  const L = { ...m.ledger };
  switch (e.kind) {
    case "capture_authorization": {
      const p = e.params as CaptureParams;
      await applyReauth(f, r, now);
      if (r.skipped) break;
      const completed = r.status === "COMPLETED";
      f.captures.push({
        captureId: r.captureId,
        cents: r.amountCents,
        refundReservedCents: 0,
        refundedCents: 0,
        purpose: "spend",
        at: now,
        status: r.status,
        ...(completed ? {} : { deferredPayouts: [{ cents: p.releaseCents, receiverEmail: p.receiverEmail ?? "", purpose: "spend", spendId: p.spendId }] }),
      });
      L.capturedCents += r.amountCents;
      await ctx.db.patch(m._id, { funding: f, ledger: L, updatedAt: now });
      await appendJournal(ctx, e.stream, "paypal", "paypal.captured", { captureId: r.captureId, amountCents: r.amountCents, status: r.status, spendId: p.spendId ?? null });
      if (completed && p.receiverEmail) {
        await enqueueEffect(ctx, {
          stream: e.stream,
          streamKind: "mandate",
          kind: "payout",
          params: { amountCents: p.releaseCents, receiverEmail: p.receiverEmail, purpose: "spend", spendId: p.spendId, note: p.note },
          ref: p.spendId,
        });
      }
      break;
    }
    case "payout": {
      const p = e.params as PayoutParams;
      L.paidOutCents += p.amountCents;
      await ctx.db.patch(m._id, { ledger: L, updatedAt: now });
      const spendId = p.spendId ? ctx.db.normalizeId("spends", p.spendId) : null;
      if (spendId) await ctx.db.patch(spendId, { status: "paid", payoutBatchId: r.payoutBatchId, updatedAt: now });
      await appendJournal(ctx, e.stream, "paypal", "spend.paid", {
        spendId: p.spendId ?? null,
        payoutBatchId: r.payoutBatchId,
        amountCents: p.amountCents,
        merchant: maskEmail(p.receiverEmail),
      });
      await notify(ctx, m.ownerId, {
        kind: "spend.paid",
        title: `Agent paid ${formatCents(p.amountCents, f.currency)}`,
        body: `${m.policy.title}: payment to ${maskEmail(p.receiverEmail)} completed.`,
        stream: m._id,
      });
      break;
    }
    case "void_authorization": {
      if (!r.skipped) {
        const voided = f.authorizationCents - f.captures.reduce((s, x) => s + x.cents, 0);
        f.voided = { cents: voided, at: now };
        L.voidedCents = voided;
      }
      await ctx.db.patch(m._id, { funding: f, ledger: L, status: "closed", closedAt: now, updatedAt: now });
      await appendJournal(ctx, e.stream, "paypal", "mandate.closed", { releasedHoldCents: f.voided?.cents ?? 0 });
      await notify(ctx, m.ownerId, { kind: "mandate.closed", title: "Mandate closed", body: `${m.policy.title}: unused budget released.`, stream: m._id });
      break;
    }
    case "reauthorize": {
      await applyReauth(f, r, now);
      await ctx.db.patch(m._id, { funding: f, updatedAt: now });
      break;
    }
    default:
      break;
  }
}

export const complete = internalMutation({
  args: { effectId: v.id("effects"), result: v.any() },
  handler: async (ctx, { effectId, result }) => {
    const e = await ctx.db.get(effectId);
    if (!e || e.status !== "in_flight") return; // already handled (duplicate execution)
    await ctx.db.patch(e._id, { status: "succeeded", result, lastError: undefined, updatedAt: Date.now() });
    if (e.streamKind === "contract") await onContractSuccess(ctx, e, result as Result);
    else await onMandateSuccess(ctx, e, result as Result);
    await ctx.scheduler.runAfter(0, internal.effects.process, { stream: e.stream });
  },
});

export const fail = internalMutation({
  args: { effectId: v.id("effects"), error: v.string(), retryable: v.boolean(), code: v.string() },
  handler: async (ctx, a) => {
    const e = await ctx.db.get(a.effectId);
    if (!e || e.status !== "in_flight") return;
    const now = Date.now();
    if (a.retryable && e.attempts < MAX_ATTEMPTS) {
      const delay = BACKOFF_MS[Math.min(e.attempts - 1, BACKOFF_MS.length - 1)];
      await ctx.db.patch(e._id, { status: "pending", nextAttemptAt: now + delay, lastError: a.error, updatedAt: now });
      await ctx.scheduler.runAfter(delay, internal.effects.process, { stream: e.stream });
      return;
    }
    await ctx.db.patch(e._id, { status: "failed", lastError: a.error, updatedAt: now });
    await appendJournal(ctx, e.stream, "paypal", "paypal.failed", { effect: e._id, kind: e.kind, code: a.code, error: a.error.slice(0, 300) });

    if (e.kind === "reauthorize") {
      // best effort only
    } else if (isStray(e)) {
      // Not the stream's own money: leave the stream running; an arbiter retries the return.
      await notifyStaff(ctx, {
        kind: "paypal.stray_failed",
        title: "Returning stray PayPal funds failed",
        body: `PayPal ${e.kind.replace(/_/g, " ")} failed (${a.code}). Retry it from the arbiter queue.`,
        stream: e.stream,
      });
    } else if (e.streamKind === "contract") {
      const id = ctx.db.normalizeId("contracts", e.stream);
      let c = id ? await ctx.db.get(id) : null;
      if (c && e.kind === "protective_capture" && c.funding) {
        // Conversion failed: stay in authorize mode so later releases never pay out uncaptured money.
        await ctx.db.patch(c._id, { funding: { ...c.funding, converting: false, runtimeMode: "authorize" }, updatedAt: now });
        c = await ctx.db.get(c._id);
      }
      if (c) await freezeContract(ctx, c, `PayPal ${e.kind.replace(/_/g, " ")} failed (${a.code}). An arbiter must resolve it.`, "system");
    } else {
      await onMandateFailure(ctx, e, a.code, a.error);
    }
    await ctx.scheduler.runAfter(0, internal.effects.process, { stream: e.stream });
  },
});

async function onMandateFailure(ctx: MutationCtx, e: Doc<"effects">, code: string, error: string) {
  const id = ctx.db.normalizeId("mandates", e.stream);
  const m = id ? await ctx.db.get(id) : null;
  if (!m) return;
  const now = Date.now();
  if (e.kind === "capture_authorization") {
    // Nothing moved: give the budget back and fail the spend.
    const p = e.params as CaptureParams;
    await ctx.db.patch(m._id, {
      spentCents: Math.max(0, m.spentCents - p.releaseCents),
      feesCents: Math.max(0, m.feesCents - p.feeCents),
      purchases: Math.max(0, m.purchases - 1),
      ledger: {
        ...m.ledger,
        heldCents: m.ledger.heldCents + p.releaseCents,
        releasedCents: Math.max(0, m.ledger.releasedCents - p.releaseCents),
        feesCents: Math.max(0, m.ledger.feesCents - p.feeCents),
      },
      updatedAt: now,
    });
    const spendId = p.spendId ? ctx.db.normalizeId("spends", p.spendId) : null;
    if (spendId) await ctx.db.patch(spendId, { status: "failed", reasons: [`PayPal capture failed: ${code}`], updatedAt: now });
    await notify(ctx, m.ownerId, { kind: "spend.failed", title: "Agent payment failed", body: error.slice(0, 200), stream: m._id });
    return;
  }
  // Money was captured but could not be paid out, or a void failed: needs a human.
  await ctx.db.patch(m._id, { status: "frozen", frozen: { reason: `PayPal ${e.kind} failed (${code})`, at: now, by: "system" }, updatedAt: now });
  await appendJournal(ctx, m._id, "system", "mandate.frozen", { reason: `PayPal ${e.kind} failed (${code})` });
  await notify(ctx, m.ownerId, { kind: "mandate.frozen", title: "Mandate frozen", body: `PayPal ${e.kind} failed. An arbiter will resolve it.`, stream: m._id });
  await notifyStaff(ctx, { kind: "mandate.frozen", title: "Mandate needs an arbiter", body: `${m.policy.title}: ${code}`, stream: m._id });
}

/** Cron: restart crashed or missed work. */
export const reapStuck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stuck = await ctx.db
      .query("effects")
      .withIndex("by_status_updated", (q) => q.eq("status", "in_flight").lt("updatedAt", now - STUCK_MS))
      .take(100);
    const due = await ctx.db
      .query("effects")
      .withIndex("by_status_next", (q) => q.eq("status", "pending").lt("nextAttemptAt", now - 60_000))
      .take(100);
    for (const stream of new Set([...stuck, ...due].map((e) => e.stream))) {
      await ctx.scheduler.runAfter(0, internal.effects.process, { stream });
    }
  },
});

/** Re-run a failed effect (arbiter). Same idempotency key, so it is safe. */
export async function requeueEffect(ctx: MutationCtx, effectId: Id<"effects">): Promise<void> {
  const e = await ctx.db.get(effectId);
  if (!e || e.status !== "failed") return;
  await ctx.db.patch(e._id, { status: "pending", attempts: 0, nextAttemptAt: Date.now(), updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.effects.process, { stream: e.stream });
}

/**
 * A capture that came back PENDING has its payout parked. When PayPal later
 * reports PAYMENT.CAPTURE.COMPLETED (webhook), this releases it.
 */
export async function releaseDeferredPayout(ctx: MutationCtx, stream: string, captureId: string): Promise<boolean> {
  const cid = ctx.db.normalizeId("contracts", stream);
  const mid = cid ? null : ctx.db.normalizeId("mandates", stream);
  const doc = cid ? await ctx.db.get(cid) : mid ? await ctx.db.get(mid) : null;
  if (!doc || !doc.funding) return false;
  const captures = doc.funding.captures.map((x) => ({ ...x }));
  const cap = captures.find((x) => x.captureId === captureId);
  if (!cap) return false;
  if (cap.status === "COMPLETED" && !cap.deferredPayouts?.length) return true; // nothing parked (or already released)
  cap.status = "COMPLETED";
  const deferred = cap.deferredPayouts ?? [];
  delete cap.deferredPayouts;
  await ctx.db.patch(doc._id, { funding: { ...doc.funding, captures }, updatedAt: Date.now() });
  for (const d of deferred) {
    if (!d.receiverEmail) continue;
    await enqueueEffect(ctx, {
      stream,
      streamKind: cid ? "contract" : "mandate",
      kind: "payout",
      params: { amountCents: d.cents, receiverEmail: d.receiverEmail, purpose: d.purpose as "release" | "spend", spendId: d.spendId },
      ref: captureId,
    });
  }
  await appendJournal(ctx, stream, "paypal", "paypal.capture_completed", { captureId, releasedPayouts: deferred.length });
  return true;
}

/** Cron: ask PayPal about captures still PENDING (backup for missed webhooks), and escrow funding waiting to clear. */
export const pollPendingCaptures = internalMutation({
  args: {},
  handler: async (ctx) => {
    const jobs: { stream: string; captureId: string; activate: boolean }[] = [];
    for (const status of ["active", "settling", "funding", "frozen"] as const) {
      const rows = await ctx.db.query("contracts").withIndex("by_status", (q) => q.eq("status", status)).take(300);
      for (const c of rows) {
        if (c.funding?.pendingCapture && status === "funding") jobs.push({ stream: c._id, captureId: c.funding.pendingCapture.captureId, activate: true });
        for (const cap of c.funding?.captures ?? []) if (cap.status === "PENDING") jobs.push({ stream: c._id, captureId: cap.captureId, activate: false });
      }
    }
    // A spend stays executing until its payout is sent, so this also finds mandates already closing, closed or frozen.
    const executing = await ctx.db.query("spends").withIndex("by_status", (q) => q.eq("status", "executing")).take(300);
    for (const mandateId of new Set(executing.map((s) => s.mandateId))) {
      const m = await ctx.db.get(mandateId);
      for (const cap of m?.funding?.captures ?? []) if (cap.status === "PENDING") jobs.push({ stream: mandateId, captureId: cap.captureId, activate: false });
    }
    for (const j of jobs.slice(0, 100)) await ctx.scheduler.runAfter(0, internal.effects.checkCapture, j);
  },
});

export const checkCapture = internalAction({
  args: { stream: v.string(), captureId: v.string(), activate: v.boolean() },
  handler: async (ctx, a) => {
    let status: string;
    try {
      status = (await getRail().getCapture(a.captureId)).status;
    } catch {
      return;
    }
    // A capture that cleared and was then (partly) refunded no longer reads COMPLETED, but its parked payouts are due.
    const cleared = status === "COMPLETED" || (!a.activate && (status === "PARTIALLY_REFUNDED" || status === "REFUNDED"));
    if (cleared) await ctx.runMutation(internal.effects._captureCompleted, a);
    else if (status === "DECLINED" || status === "FAILED") await ctx.runMutation(internal.effects._captureFailed, { stream: a.stream, captureId: a.captureId, status });
  },
});

export const _captureCompleted = internalMutation({
  args: { stream: v.string(), captureId: v.string(), activate: v.boolean() },
  handler: async (ctx, a) => {
    if (a.activate) {
      await activatePendingEscrow(ctx, a.stream, a.captureId);
      return;
    }
    await releaseDeferredPayout(ctx, a.stream, a.captureId);
  },
});

export const _captureFailed = internalMutation({
  args: { stream: v.string(), captureId: v.string(), status: v.string() },
  handler: async (ctx, a) => {
    const cid = ctx.db.normalizeId("contracts", a.stream);
    const mid = cid ? null : ctx.db.normalizeId("mandates", a.stream);
    const doc = cid ? await ctx.db.get(cid) : mid ? await ctx.db.get(mid) : null;
    if (!doc) return;
    if (doc.funding?.captures.some((x) => x.captureId === a.captureId && x.status === "PENDING")) {
      // Record the outcome so the poller stops asking. Payouts parked on it stay parked for the arbiter.
      const captures = doc.funding.captures.map((x) => (x.captureId === a.captureId ? { ...x, status: a.status } : x));
      await ctx.db.patch(doc._id, { funding: { ...doc.funding, captures }, updatedAt: Date.now() });
    }
    await freezeStream(ctx, a.stream, `PayPal capture ${a.captureId} is ${a.status}.`);
  },
});

/** Freeze a contract or mandate because PayPal reported a problem. False when the stream does not exist. */
export async function freezeStream(ctx: MutationCtx, stream: string, reason: string): Promise<boolean> {
  const cid = ctx.db.normalizeId("contracts", stream);
  if (cid) {
    const c = await ctx.db.get(cid);
    if (!c) return false;
    await freezeContract(ctx, c, reason, "paypal");
    return true;
  }
  const mid = ctx.db.normalizeId("mandates", stream);
  const m = mid ? await ctx.db.get(mid) : null;
  if (!m) return false;
  if (m.status !== "frozen") {
    await ctx.db.patch(m._id, { status: "frozen", frozen: { reason, at: Date.now(), by: "paypal" }, updatedAt: Date.now() });
    await appendJournal(ctx, m._id, "paypal", "mandate.frozen", { reason });
    await notify(ctx, m.ownerId, { kind: "mandate.frozen", title: "Mandate frozen", body: reason, stream: m._id });
    await notifyStaff(ctx, { kind: "mandate.frozen", title: "Mandate needs an arbiter", body: reason, stream: m._id });
  }
  return true;
}

/** Escrow funding that was PENDING has cleared: start the contract now. */
export async function activatePendingEscrow(ctx: MutationCtx, stream: string, captureId: string): Promise<boolean> {
  const id = ctx.db.normalizeId("contracts", stream);
  const c = id ? await ctx.db.get(id) : null;
  const pc = c?.funding?.pendingCapture;
  if (!c || c.status !== "funding" || !pc || pc.captureId !== captureId || !c.funding?.orderId) return false;
  await ctx.scheduler.runAfter(0, internal.engine.activate, {
    contractId: c._id,
    orderId: c.funding.orderId,
    captureId,
    paypalStatus: "COMPLETED",
    amountCents: pc.amountCents,
    currency: pc.currency,
  });
  return true;
}

/**
 * Give back money PayPal took on a checkout that no longer funds the stream
 * (reset, replaced, cancelled or revoked while the PayPal call was in flight):
 * void the authorization, or refund the capture. The stream's own funding,
 * ledger and status are never touched. Repeats are no-ops (one effect per
 * authorization or capture, found by ref), so nothing is returned twice.
 */
export async function returnStrayFunds(
  ctx: MutationCtx,
  a: { stream: string; streamKind: "contract" | "mandate"; authorizationId?: string; captureId?: string; amountCents: number; reason: string },
): Promise<void> {
  const target = a.authorizationId || a.captureId;
  if (!target) failWith("INVALID_ARGUMENT", "authorizationId or captureId required to return stray funds.");
  const ref = `stray:${target}`;
  if (await findEffectByRef(ctx, a.stream, ref)) return;
  if (a.authorizationId) {
    await enqueueEffect(ctx, {
      stream: a.stream,
      streamKind: a.streamKind,
      kind: "void_authorization",
      params: { authorizationId: a.authorizationId, amountCents: a.amountCents, stray: true },
      ref,
    });
  } else {
    await enqueueEffect(ctx, {
      stream: a.stream,
      streamKind: a.streamKind,
      kind: "refund_capture",
      params: { captureId: target, amountCents: a.amountCents, stray: true, note: "Returned: this checkout was closed" },
      ref,
    });
  }
  await appendJournal(ctx, a.stream, "paypal", "paypal.stray_funds", {
    reason: a.reason,
    authorizationId: a.authorizationId ?? null,
    captureId: a.captureId ?? null,
    amountCents: a.amountCents,
  });
}

/** True when nothing is pending for this stream (used by mandate closing). */
export { hasOpenEffects };
