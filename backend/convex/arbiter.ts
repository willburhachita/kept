/**
 * Arbiter console: the only humans who can resolve disputes, resume frozen
 * contracts and retry failed PayPal effects. Every action is journaled with
 * the arbiter as actor.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { resumeContract } from "./engine";
import { requeueEffect } from "./effects";
import { arbitrate } from "./evidence";
import { assertEmail, loadContract, maskEmail, requireArbiter, requireUserId } from "./lib/authz";
import { fail } from "./lib/errors";
import { appendJournal, type Actor } from "./lib/journal";
import type { PayoutParams } from "./lib/outbox";
import { closeMandate } from "./mandates";

const arbiterActor = (id: Id<"users">): Actor => `arbiter:${id}`;

export const queue = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    await requireArbiter(ctx, userId);
    const now = Date.now();
    const evidence = await ctx.db.query("evidence").withIndex("by_status", (q) => q.eq("status", "in_arbitration")).take(100);
    const frozenContracts = await ctx.db.query("contracts").withIndex("by_status", (q) => q.eq("status", "frozen")).take(100);
    const frozenMandates = await ctx.db.query("mandates").withIndex("by_status", (q) => q.eq("status", "frozen")).take(100);
    const failedEffects = await ctx.db.query("effects").withIndex("by_status_next", (q) => q.eq("status", "failed")).take(100);
    return {
      counts: { evidence: evidence.length, frozenContracts: frozenContracts.length, frozenMandates: frozenMandates.length, failedEffects: failedEffects.length },
      evidence: await Promise.all(
        evidence.map(async (ev) => {
          const c = await ctx.db.get(ev.contractId);
          return {
            _id: ev._id,
            contractId: ev.contractId,
            contractTitle: c?.ir?.title ?? "",
            slotLabel: c?.ir?.evidence.find((s) => s.id === ev.slotId)?.label ?? ev.slotId,
            criteria: c?.ir?.evidence.find((s) => s.id === ev.slotId)?.criteria ?? [],
            ai: ev.ai ?? null,
            challenge: ev.challenge ?? null,
            dispute: ev.dispute ?? null,
            fileUrl: ev.storageId ? await ctx.storage.getUrl(ev.storageId) : null,
            text: ev.text ?? null,
            url: ev.url ?? null,
            submittedAt: ev.submittedAt,
            dueAt: ev.arbitrationDueAt ?? null,
            overdue: (ev.arbitrationDueAt ?? Infinity) < now,
            ageMs: now - ev.submittedAt,
          };
        }),
      ),
      frozenContracts: frozenContracts.map((c) => ({
        _id: c._id,
        title: c.ir?.title ?? c.prompt.slice(0, 80),
        reason: c.frozen?.reason ?? "",
        frozenAt: c.frozen?.at ?? null,
        ledger: c.ledger,
        payoutEmail: maskEmail(c.approvals.payee?.payoutEmail),
      })),
      frozenMandates: frozenMandates.map((m) => ({ _id: m._id, title: m.policy.title, reason: m.frozen?.reason ?? "", frozenAt: m.frozen?.at ?? null })),
      failedEffects: failedEffects.map((e) => ({ _id: e._id, stream: e.stream, streamKind: e.streamKind, kind: e.kind, attempts: e.attempts, lastError: e.lastError ?? null, updatedAt: e.updatedAt })),
    };
  },
});

export const decide = mutation({
  args: { evidenceId: v.id("evidence"), outcome: v.union(v.literal("accepted"), v.literal("rejected")), reason: v.string() },
  handler: async (ctx, { evidenceId, outcome, reason }) => {
    const userId = await requireUserId(ctx);
    await requireArbiter(ctx, userId);
    await arbitrate(ctx, evidenceId, outcome, arbiterActor(userId), reason);
    return { status: outcome };
  },
});

export const resume = mutation({
  args: { contractId: v.id("contracts"), note: v.string() },
  handler: async (ctx, { contractId, note }) => {
    const userId = await requireUserId(ctx);
    await requireArbiter(ctx, userId);
    if (!note.trim()) fail("INVALID_ARGUMENT", "Explain why the contract can resume.");
    await resumeContract(ctx, contractId, arbiterActor(userId), note.trim().slice(0, 500));
  },
});

export const retryEffect = mutation({
  args: { effectId: v.id("effects") },
  handler: async (ctx, { effectId }) => {
    const userId = await requireUserId(ctx);
    await requireArbiter(ctx, userId);
    const e = await ctx.db.get(effectId);
    if (!e || e.status !== "failed") fail("INVALID_STATE", "Only failed effects can be retried.");
    // A failed spend capture was already rolled back (budget restored, spend marked failed); retrying it would pay outside the books.
    if (e.streamKind === "mandate" && e.kind === "capture_authorization") {
      fail("INVALID_STATE", "This spend was rolled back when its capture failed; the agent can request it again.");
    }
    await requeueEffect(ctx, effectId);
    await appendJournal(ctx, e.stream, arbiterActor(userId), "effect.retried", { effectId, kind: e.kind });
  },
});

/**
 * Fix a payee payout email that PayPal rejected. Also repoints every payee
 * release not yet paid: queued or failed payouts, and payouts parked behind
 * a PENDING capture.
 */
export const setPayoutEmail = mutation({
  args: { contractId: v.id("contracts"), email: v.string(), reason: v.string() },
  handler: async (ctx, { contractId, email, reason }) => {
    const userId = await requireUserId(ctx);
    await requireArbiter(ctx, userId);
    const c = await loadContract(ctx, contractId);
    if (c.status !== "frozen" || !c.approvals.payee) fail("INVALID_STATE", "Only a frozen contract with an approved payee can be changed.");
    const clean = assertEmail(email, "email");
    const now = Date.now();
    let repointed = 0;
    const repoint = <T extends { purpose: string; receiverEmail: string }>(p: T): T => {
      if (p.purpose !== "release") return p;
      repointed++;
      return { ...p, receiverEmail: clean };
    };
    const captures = (c.funding?.captures ?? []).map((cap) => (cap.deferredPayouts ? { ...cap, deferredPayouts: cap.deferredPayouts.map(repoint) } : cap));
    await ctx.db.patch(c._id, {
      approvals: { ...c.approvals, payee: { ...c.approvals.payee, payoutEmail: clean } },
      ...(c.funding ? { funding: { ...c.funding, captures } } : {}),
      updatedAt: now,
    });
    const effects = await ctx.db.query("effects").withIndex("by_stream_seq", (q) => q.eq("stream", c._id)).take(500);
    for (const e of effects) {
      if (e.kind === "payout" && (e.status === "pending" || e.status === "failed")) {
        const params = repoint(e.params as PayoutParams);
        if (params !== e.params) await ctx.db.patch(e._id, { params, updatedAt: now });
      }
    }
    await appendJournal(ctx, c._id, arbiterActor(userId), "payee.payout_email_changed", { to: maskEmail(clean), reason: reason.slice(0, 300), repointed });
  },
});

/**
 * Resume a frozen mandate. Failed voids are retried (same idempotency keys)
 * and effects parked while frozen are released. A mandate that was closing,
 * or whose expiry passed meanwhile, finishes closing instead of going back
 * to active.
 */
export const resumeMandate = mutation({
  args: { mandateId: v.id("mandates"), note: v.string() },
  handler: async (ctx, { mandateId, note }) => {
    const userId = await requireUserId(ctx);
    await requireArbiter(ctx, userId);
    const m = await ctx.db.get(mandateId);
    if (!m || m.status !== "frozen") fail("INVALID_STATE", "Mandate is not frozen.");
    const actor = arbiterActor(userId);
    const now = Date.now();
    const effects = await ctx.db.query("effects").withIndex("by_stream_seq", (q) => q.eq("stream", m._id)).take(500);
    let closing = false;
    for (const e of effects) {
      const isVoid = e.kind === "void_authorization";
      // Only closeMandate enqueues the main void; stray-fund voids carry params.stray.
      if (isVoid && !e.params?.stray && e.status !== "succeeded") closing = true;
      if (isVoid && e.status === "failed") await ctx.db.patch(e._id, { status: "pending", attempts: 0, nextAttemptAt: now, updatedAt: now });
      else if (e.status === "pending" && e.nextAttemptAt > now) await ctx.db.patch(e._id, { nextAttemptAt: now, updatedAt: now });
    }
    if (m.closedAt) {
      // It had finished closing before it froze (e.g. a late payout failed): it stays closed.
      await ctx.db.patch(m._id, { status: m.funding?.authorizationId ? "closed" : "revoked", frozen: undefined, updatedAt: now });
    } else if (closing) {
      await ctx.db.patch(m._id, { status: "closing", frozen: undefined, updatedAt: now });
    } else if ((m.expiresAt ?? 0) <= now) {
      await ctx.db.patch(m._id, { frozen: undefined, updatedAt: now });
      await closeMandate(ctx, (await ctx.db.get(m._id))!, m.activatedAt ? "expired" : "never activated", actor);
    } else {
      await ctx.db.patch(m._id, { status: "active", frozen: undefined, updatedAt: now });
    }
    const status = (await ctx.db.get(m._id))?.status ?? m.status;
    await appendJournal(ctx, m._id, actor, "mandate.resumed", { note: note.slice(0, 300), status });
    await ctx.scheduler.runAfter(0, internal.effects.process, { stream: m._id });
  },
});
