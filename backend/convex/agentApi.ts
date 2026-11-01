/**
 * The agent-facing side of mandates, used by the REST agent API and the
 * remote MCP endpoint. Agents authenticate with a mandate token (only its
 * SHA-256 is stored) and never see the owner's personal data.
 *
 * Decision order for a spend: deterministic guard (evaluateSpend) first;
 * then, if AI is configured, a screener that can only escalate to a human.
 */
import { SPEND_REVIEW_SCHEMA, evaluateSpend, formatCents } from "@kept/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { aiConfigured, callStructured } from "./ai/claude";
import { SCREENER_SYSTEM, screenerRequest } from "./ai/screener";
import { maskEmail } from "./lib/authz";
import { fail } from "./lib/errors";
import { appendJournal, type Actor } from "./lib/journal";
import { notify } from "./lib/notify";
import { LIMITS, rateLimit } from "./lib/rateLimit";
import { executeSpend } from "./mandates";

const HOUR = 3_600_000;
const agentActor = (tokenId: Id<"agentTokens">): Actor => `agent:${tokenId}`;

async function auth(ctx: QueryCtx, tokenHash: string) {
  const t = await ctx.db.query("agentTokens").withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
  if (!t || t.revokedAt || t.expiresAt <= Date.now()) return null;
  const m = await ctx.db.get(t.mandateId);
  if (!m) return null;
  return { token: t, mandate: m };
}

function spendView(s: Doc<"spends">, m: Doc<"mandates">) {
  return {
    spendId: s._id,
    status: s.status,
    reasons: s.reasons,
    amountCents: s.amountCents,
    feeCents: s.feeCents,
    amount: formatCents(s.amountCents, s.currency),
    currency: s.currency,
    merchantEmail: s.merchantEmail,
    merchantName: s.merchantName,
    description: s.description,
    remainingCents: Math.max(0, m.policy.budgetCents - m.spentCents - m.reservedCents),
    createdAt: s.createdAt,
    final: ["paid", "denied", "failed", "cancelled"].includes(s.status),
  };
}

export const authenticate = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const a = await auth(ctx, tokenHash);
    return a ? { tokenId: a.token._id, mandateId: a.mandate._id, ownerId: a.mandate.ownerId, mandateStatus: a.mandate.status } : null;
  },
});

/** What the agent may do right now. */
export const mandateForAgent = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const a = await auth(ctx, tokenHash);
    if (!a) return null;
    const m = a.mandate;
    const p = m.policy;
    const now = Date.now();
    const recent = await ctx.db.query("spends").withIndex("by_mandate", (q) => q.eq("mandateId", m._id)).order("desc").take(10);
    return {
      mandateId: m._id,
      title: p.title,
      purpose: p.purpose,
      status: m.status,
      canSpend: m.status === "active" && (m.expiresAt ?? 0) > now,
      currency: p.currency,
      budgetCents: p.budgetCents,
      spentCents: m.spentCents,
      reservedCents: m.reservedCents,
      remainingCents: Math.max(0, p.budgetCents - m.spentCents - m.reservedCents),
      perPurchaseMaxCents: p.perPurchaseMaxCents,
      approvalAboveCents: p.approvalAboveCents,
      maxPurchases: p.maxPurchases,
      purchasesLeft: Math.max(0, p.maxPurchases - m.purchases),
      maxPerHour: p.maxPerHour,
      purchasesLastHour: m.recentSpendTimes.filter((t) => now - t < HOUR).length,
      allowedMerchants: p.allowedMerchants,
      expiresAt: m.expiresAt ?? null,
      msUntilExpiry: m.expiresAt ? Math.max(0, m.expiresAt - now) : null,
      feeBps: m.feeBps,
      tokenExpiresAt: a.token.expiresAt,
      recentSpends: recent.map((s) => ({ spendId: s._id, status: s.status, amountCents: s.amountCents, merchantEmail: s.merchantEmail, reasons: s.reasons, createdAt: s.createdAt })),
    };
  },
});

export const requestSpend = internalMutation({
  args: {
    tokenHash: v.string(),
    merchantEmail: v.string(),
    merchantName: v.string(),
    amountCents: v.number(),
    currency: v.string(),
    description: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, a) => {
    const found = await auth(ctx, a.tokenHash);
    if (!found) fail("UNAUTHENTICATED", "Invalid, revoked or expired mandate token.");
    const { token, mandate: m } = found;
    await rateLimit(ctx, `agent:${token._id}`, LIMITS.agentSpend);
    const key = a.idempotencyKey.trim();
    if (!key || key.length > 100) fail("INVALID_ARGUMENT", "idempotencyKey must be 1-100 characters.");
    const existing = await ctx.db.query("spends").withIndex("by_token_key", (q) => q.eq("tokenId", token._id).eq("idempotencyKey", key)).unique();
    if (existing) return spendView(existing, m);

    const now = Date.now();
    const merchantEmail = a.merchantEmail.trim().toLowerCase().slice(0, 254);
    const req = { amountCents: a.amountCents, currency: a.currency, merchantEmail, description: a.description };
    const ev = evaluateSpend(
      m.policy,
      { status: m.status, activatedAt: m.activatedAt ?? null, spentCents: m.spentCents, reservedCents: m.reservedCents, purchases: m.purchases, recentSpendTimes: m.recentSpendTimes },
      req,
      now,
      m.feeBps,
    );
    const screening = ev.decision === "approve" && aiConfigured();
    const status = ev.decision === "deny" ? "denied" : ev.decision === "needs_approval" ? "needs_approval" : screening ? "screening" : "executing";
    const spendId = await ctx.db.insert("spends", {
      mandateId: m._id,
      tokenId: token._id,
      idempotencyKey: key,
      merchantEmail,
      merchantName: a.merchantName.trim().slice(0, 120) || merchantEmail,
      amountCents: Number.isSafeInteger(a.amountCents) ? a.amountCents : 0,
      feeCents: ev.feeCents,
      currency: m.policy.currency,
      description: a.description.trim().slice(0, 500),
      status: status === "executing" ? "screening" : status, // executeSpend sets "executing"
      reasons: ev.reasons,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(token._id, { lastUsedAt: now });
    await appendJournal(ctx, m._id, agentActor(token._id), "spend.requested", {
      spendId,
      amountCents: a.amountCents,
      merchant: maskEmail(merchantEmail),
      decision: ev.decision,
      reasons: ev.reasons.slice(0, 5),
    });
    if (status === "needs_approval" || status === "screening") {
      await ctx.db.patch(m._id, { reservedCents: m.reservedCents + a.amountCents, updatedAt: now });
    }
    if (status === "screening") await ctx.scheduler.runAfter(0, internal.agentApi.screen, { spendId });
    if (status === "needs_approval") {
      await notify(ctx, m.ownerId, {
        kind: "spend.needs_approval",
        title: `Approve ${formatCents(a.amountCents, m.policy.currency)}?`,
        body: `${m.policy.title}: ${a.merchantName.slice(0, 60)} - ${a.description.slice(0, 120)}`,
        stream: m._id,
      });
    }
    if (status === "executing") {
      const spend = (await ctx.db.get(spendId))!;
      await executeSpend(ctx, (await ctx.db.get(m._id))!, spend, agentActor(token._id), false);
    }
    const spend = (await ctx.db.get(spendId))!;
    return spendView(spend, (await ctx.db.get(m._id))!);
  },
});

export const _screenJob = internalQuery({
  args: { spendId: v.id("spends") },
  handler: async (ctx, { spendId }) => {
    const s = await ctx.db.get(spendId);
    if (!s || s.status !== "screening") return null;
    const m = await ctx.db.get(s.mandateId);
    return m ? { policy: m.policy, spend: { merchantName: s.merchantName, merchantEmail: s.merchantEmail, amountCents: s.amountCents, description: s.description } } : null;
  },
});

/** AI screening of an approved-by-policy spend. Can only escalate. */
export const screen = internalAction({
  args: { spendId: v.id("spends") },
  handler: async (ctx, { spendId }) => {
    const job = await ctx.runQuery(internal.agentApi._screenJob, { spendId });
    if (!job) return;
    let review: { fits: boolean; risk: "low" | "medium" | "high"; reasons: string[]; model?: string } | null = null;
    try {
      const r = await callStructured<{ fits: boolean; risk: "low" | "medium" | "high"; reasons: string[] }>({
        system: SCREENER_SYSTEM,
        content: screenerRequest(job.policy, job.spend),
        schema: SPEND_REVIEW_SCHEMA,
        effort: "low",
        maxTokens: 2000,
      });
      review = { ...r.value, model: r.model };
    } catch {
      review = null;
    }
    await ctx.runMutation(internal.agentApi.finishScreening, { spendId, review });
  },
});

export const finishScreening = internalMutation({
  args: { spendId: v.id("spends"), review: v.union(v.any(), v.null()) },
  handler: async (ctx, { spendId, review }) => {
    const s = await ctx.db.get(spendId);
    if (!s || s.status !== "screening") return;
    const m = await ctx.db.get(s.mandateId);
    if (!m) return;
    const r = review as { fits: boolean; risk: string; reasons: string[] } | null;
    const now = Date.now();
    if (m.status === "active" && r && r.fits === true && r.risk === "low") {
      await ctx.db.patch(s._id, { review: r });
      await executeSpend(ctx, m, (await ctx.db.get(s._id))!, "system", true);
      return;
    }
    const reasons = r ? [`AI screening: ${r.risk} risk`, ...(Array.isArray(r.reasons) ? r.reasons.slice(0, 5) : [])] : ["AI screening unavailable; needs your approval."];
    await ctx.db.patch(s._id, { status: "needs_approval", review: r ?? undefined, reasons: [...s.reasons, ...reasons], updatedAt: now });
    await appendJournal(ctx, m._id, "system", "spend.escalated", { spendId, risk: r?.risk ?? null });
    await notify(ctx, m.ownerId, {
      kind: "spend.needs_approval",
      title: `Approve ${formatCents(s.amountCents, s.currency)}?`,
      body: `${m.policy.title}: ${reasons.join("; ").slice(0, 180)}`,
      stream: m._id,
    });
  },
});

export const getSpend = internalQuery({
  args: { tokenHash: v.string(), spendId: v.string() },
  handler: async (ctx, { tokenHash, spendId }) => {
    const a = await auth(ctx, tokenHash);
    if (!a) return null;
    const id = ctx.db.normalizeId("spends", spendId);
    const s = id ? await ctx.db.get(id) : null;
    if (!s || s.mandateId !== a.mandate._id) return null;
    return spendView(s, a.mandate);
  },
});
