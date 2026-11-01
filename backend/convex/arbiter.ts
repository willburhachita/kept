/**
 * Arbiter console: the only humans who can resolve disputes, resume frozen
 * contracts and retry failed PayPal effects. Every action is journaled with
 * the arbiter as actor.
 */
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { resumeContract } from "./engine";
import { requeueEffect } from "./effects";
import { arbitrate } from "./evidence";
import { assertEmail, loadContract, maskEmail, requireArbiter, requireUserId } from "./lib/authz";
import { fail } from "./lib/errors";
import { appendJournal, type Actor } from "./lib/journal";

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
    await requeueEffect(ctx, effectId);
    await appendJournal(ctx, e.stream, arbiterActor(userId), "effect.retried", { effectId, kind: e.kind });
  },
});

/** Fix a payee payout email that PayPal rejected; also repoints unfinished payouts. */
export const setPayoutEmail = mutation({
  args: { contractId: v.id("contracts"), email: v.string(), reason: v.string() },
  handler: async (ctx, { contractId, email, reason }) => {
    const userId = await requireUserId(ctx);
    await requireArbiter(ctx, userId);
    const c = await loadContract(ctx, contractId);
    if (c.status !== "frozen" || !c.approvals.payee) fail("INVALID_STATE", "Only a frozen contract with an approved payee can be changed.");
    const clean = assertEmail(email, "email");
    await ctx.db.patch(c._id, { approvals: { ...c.approvals, payee: { ...c.approvals.payee, payoutEmail: clean } }, updatedAt: Date.now() });
    const effects = await ctx.db.query("effects").withIndex("by_stream_seq", (q) => q.eq("stream", c._id)).take(500);
    for (const e of effects) {
      if (e.kind === "payout" && (e.status === "pending" || e.status === "failed")) await ctx.db.patch(e._id, { params: { ...e.params, receiverEmail: clean } });
    }
    await appendJournal(ctx, c._id, arbiterActor(userId), "payee.payout_email_changed", { to: maskEmail(clean), reason: reason.slice(0, 300) });
  },
});

export const resumeMandate = mutation({
  args: { mandateId: v.id("mandates"), note: v.string() },
  handler: async (ctx, { mandateId, note }) => {
    const userId = await requireUserId(ctx);
    await requireArbiter(ctx, userId);
    const m = await ctx.db.get(mandateId);
    if (!m || m.status !== "frozen") fail("INVALID_STATE", "Mandate is not frozen.");
    const expired = (m.expiresAt ?? 0) <= Date.now();
    await ctx.db.patch(m._id, { status: expired ? "closing" : "active", frozen: undefined, updatedAt: Date.now() });
    await appendJournal(ctx, m._id, arbiterActor(userId), "mandate.resumed", { note: note.slice(0, 300), status: expired ? "closing" : "active" });
  },
});
