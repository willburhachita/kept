/**
 * Agent mandates: a budget held on the owner's PayPal authorization plus a
 * policy. AI agents get scoped tokens instead of cards; every purchase they
 * request is checked by the pure guard in @kept/core (see agentApi.ts).
 */
import {
  MANDATE_OUTPUT_SCHEMA,
  PAYPAL_RULES,
  authorizationAmount,
  canonicalJson,
  evaluateSpend,
  feeForRelease,
  formatCents,
  formatHours,
  maxFee,
  sha256Hex,
  validateMandate,
  verifyMandate,
  type MandatePolicy,
  type MandateReport,
} from "@kept/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import { aiConfigured, callStructured } from "./ai/claude";
import { MANDATE_DRAFT_SYSTEM, mandateDraftRequest } from "./ai/screener";
import { rethrowRail } from "./funding";
import { getProfile, isStaff, maskEmail, requireUserId } from "./lib/authz";
import { env } from "./lib/env";
import { fail } from "./lib/errors";
import { actorUser, appendJournal, type Actor } from "./lib/journal";
import { postLedger } from "./lib/ledger";
import { notify } from "./lib/notify";
import { enqueueEffect } from "./lib/outbox";
import { LIMITS, rateLimit } from "./lib/rateLimit";
import { issueSecret } from "./lib/secrets";
import { getRail } from "./rails";
import { mandatePolicyV } from "./lib/validators";

const HOUR = 3_600_000;
const MAX_TOKENS = 10;

type Mandate = Doc<"mandates">;

const emptyLedger = (principalCents: number) => ({
  principalCents,
  heldCents: 0,
  releasedCents: 0,
  refundedCents: 0,
  feesCents: 0,
  capturedCents: 0,
  paidOutCents: 0,
  refundExecutedCents: 0,
  voidedCents: 0,
});

async function ownedMandate(ctx: QueryCtx | MutationCtx, userId: Id<"users">, mandateId: Id<"mandates">): Promise<Mandate> {
  const m = await ctx.db.get(mandateId);
  if (!m) fail("NOT_FOUND", "Mandate not found.");
  if (m.ownerId === userId) return m;
  if (isStaff(await getProfile(ctx, userId))) return m;
  fail("NOT_FOUND", "Mandate not found.");
}

export function policyLines(p: MandatePolicy): string[] {
  const f = (c: number) => formatCents(c, p.currency);
  return [
    `Purpose: ${p.purpose}`,
    `Budget: ${f(p.budgetCents)} in total, at most ${f(p.perPurchaseMaxCents)} per purchase, at most ${p.maxPurchases} purchases.`,
    p.approvalAboveCents === null ? "No purchase needs your approval inside these limits." : `Purchases above ${f(p.approvalAboveCents)} wait for your approval.`,
    p.allowedMerchants.length ? `Only these merchants: ${p.allowedMerchants.join(", ")}.` : "Any merchant (no allowlist).",
    `At most ${p.maxPerHour} purchases per hour. Expires ${formatHours(p.expiresAfterHours)} after funding.`,
  ];
}

// ---------------------------------------------------------------------------
// Draft + create
// ---------------------------------------------------------------------------

/** Draft a policy from plain English with Claude. Nothing is stored. */
export const draftFromPrompt = action({
  args: { prompt: v.string() },
  handler: async (ctx, { prompt }) => {
    await requireUserId(ctx);
    const text = prompt.trim();
    if (!text || text.length > 2000) fail("INVALID_ARGUMENT", "Describe the mandate in 1-2000 characters.");
    if (!aiConfigured()) fail("CONFIG_MISSING", "AI is not configured (ANTHROPIC_API_KEY).");
    const r = await callStructured<Omit<MandatePolicy, "version"> & { assumptions: string[] }>({
      system: MANDATE_DRAFT_SYSTEM,
      content: mandateDraftRequest(text),
      schema: MANDATE_OUTPUT_SCHEMA,
      effort: "medium",
      maxTokens: 4000,
    });
    const { assumptions, ...rest } = r.value;
    const candidate = { version: 1 as const, ...rest };
    const res = validateMandate(candidate);
    return {
      policy: res.ok ? res.value : candidate,
      valid: res.ok,
      issues: res.issues,
      assumptions: assumptions ?? [],
      report: res.ok ? verifyMandate(res.value, env.feeBps()) : null,
      lines: res.ok ? policyLines(res.value) : [],
    };
  },
});

async function createFlow(ctx: MutationCtx, userId: Id<"users">, rawPolicy: unknown, prompt?: string) {
  await rateLimit(ctx, `mandate:${userId}`, LIMITS.createContract);
  const res = validateMandate(rawPolicy);
  if (!res.ok) fail("INVALID_ARGUMENT", "The mandate policy is not valid.", { issues: res.issues.map((i) => `${i.path}: ${i.message}`).slice(0, 20) });
  const policy = res.value;
  const feeBps = env.feeBps();
  const report = verifyMandate(policy, feeBps);
  const now = Date.now();
  const policyHash = sha256Hex(canonicalJson(policy));
  const mandateId = await ctx.db.insert("mandates", {
    ownerId: userId,
    status: report.ok ? "awaiting_funding" : "draft",
    prompt: prompt?.slice(0, 2000),
    policy,
    policyHash,
    feeBps,
    report,
    spentCents: 0,
    reservedCents: 0,
    feesCents: 0,
    purchases: 0,
    recentSpendTimes: [],
    ledger: emptyLedger(policy.budgetCents),
    createdAt: now,
    updatedAt: now,
  });
  await appendJournal(ctx, mandateId, actorUser(userId), "mandate.created", {
    policyHash,
    budgetCents: policy.budgetCents,
    perPurchaseMaxCents: policy.perPurchaseMaxCents,
    expiresAfterHours: policy.expiresAfterHours,
    merchants: policy.allowedMerchants.length,
    verified: report.ok,
  });
  return { mandateId, verified: report.ok, report };
}

/** Create a mandate from a policy (from draftFromPrompt or hand-written). */
export const create = mutation({
  args: { policy: mandatePolicyV, prompt: v.optional(v.string()) },
  handler: async (ctx, { policy, prompt }) => createFlow(ctx, await requireUserId(ctx), policy, prompt),
});

export const createAs = internalMutation({
  args: { userId: v.id("users"), policy: v.any(), prompt: v.optional(v.string()) },
  handler: async (ctx, { userId, policy, prompt }) => createFlow(ctx, userId, policy, prompt),
});

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

async function viewFlow(ctx: QueryCtx, userId: Id<"users">, mandateId: Id<"mandates">) {
  const m = await ownedMandate(ctx, userId, mandateId);
  const now = Date.now();
  const p = m.policy;
  const f = (c: number) => formatCents(c, p.currency);
  const tokens = await ctx.db.query("agentTokens").withIndex("by_mandate", (q) => q.eq("mandateId", m._id)).take(50);
  const spends = await ctx.db.query("spends").withIndex("by_mandate", (q) => q.eq("mandateId", m._id)).order("desc").take(200);
  const byStatus: Record<string, number> = {};
  for (const s of spends) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  const remainingCents = Math.max(0, p.budgetCents - m.spentCents - m.reservedCents);
  return {
    _id: m._id,
    status: m.status,
    policy: p,
    policyHash: m.policyHash,
    lines: policyLines(p),
    report: m.report as MandateReport | undefined,
    feeBps: m.feeBps,
    authorizationCents: authorizationAmount(p.budgetCents, m.feeBps),
    maxFeeCents: maxFee(p.budgetCents, m.feeBps),
    spentCents: m.spentCents,
    reservedCents: m.reservedCents,
    feesCents: m.feesCents,
    remainingCents,
    purchases: m.purchases,
    purchasesLeft: Math.max(0, p.maxPurchases - m.purchases),
    purchasesLastHour: m.recentSpendTimes.filter((t) => now - t < HOUR).length,
    money: { budget: f(p.budgetCents), spent: f(m.spentCents), reserved: f(m.reservedCents), remaining: f(remainingCents), fees: f(m.feesCents) },
    activatedAt: m.activatedAt ?? null,
    expiresAt: m.expiresAt ?? null,
    msUntilExpiry: m.expiresAt ? Math.max(0, m.expiresAt - now) : null,
    funding: m.funding
      ? {
          authorizationCents: m.funding.authorizationCents,
          approveUrl: m.status === "funding" ? (m.funding.approveUrl ?? null) : null,
          authorizedAt: m.funding.authorizedAt ?? null,
          honorEndsAt: m.funding.honorEndsAt ?? null,
          authorizationExpiresAt: m.funding.expiresAt ?? null,
          capturedCents: m.ledger.capturedCents,
          paidOutCents: m.ledger.paidOutCents,
          voided: m.funding.voided ?? null,
        }
      : null,
    tokens: tokens.map((t) => ({
      _id: t._id,
      prefix: t.prefix,
      label: t.label,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
      lastUsedAt: t.lastUsedAt ?? null,
      revoked: Boolean(t.revokedAt),
      active: !t.revokedAt && t.expiresAt > now,
    })),
    spendCounts: byStatus,
    pendingApprovals: spends.filter((s) => s.status === "needs_approval").length,
    frozen: m.frozen ?? null,
    closedAt: m.closedAt ?? null,
    createdAt: m.createdAt,
  };
}

export const get = query({
  args: { mandateId: v.id("mandates") },
  handler: async (ctx, { mandateId }) => viewFlow(ctx, await requireUserId(ctx), mandateId),
});

export const getAs = internalQuery({
  args: { userId: v.id("users"), mandateId: v.id("mandates") },
  handler: async (ctx, { userId, mandateId }) => viewFlow(ctx, userId, mandateId),
});

async function listFlow(ctx: QueryCtx, userId: Id<"users">) {
  const rows = await ctx.db.query("mandates").withIndex("by_owner", (q) => q.eq("ownerId", userId)).order("desc").take(100);
  return rows.map((m) => ({
    _id: m._id,
    title: m.policy.title,
    status: m.status,
    currency: m.policy.currency,
    budgetCents: m.policy.budgetCents,
    spentCents: m.spentCents,
    remainingCents: Math.max(0, m.policy.budgetCents - m.spentCents - m.reservedCents),
    expiresAt: m.expiresAt ?? null,
    updatedAt: m.updatedAt,
  }));
}

export const listMine = query({ args: {}, handler: async (ctx) => listFlow(ctx, await requireUserId(ctx)) });
export const listAs = internalQuery({ args: { userId: v.id("users") }, handler: async (ctx, { userId }) => listFlow(ctx, userId) });

async function spendsFlow(ctx: QueryCtx, userId: Id<"users">, mandateId: Id<"mandates">) {
  const m = await ownedMandate(ctx, userId, mandateId);
  const rows = await ctx.db.query("spends").withIndex("by_mandate", (q) => q.eq("mandateId", m._id)).order("desc").take(200);
  return rows.map((s) => ({
    _id: s._id,
    status: s.status,
    merchantName: s.merchantName,
    merchantEmail: s.merchantEmail,
    amountCents: s.amountCents,
    feeCents: s.feeCents,
    amount: formatCents(s.amountCents, s.currency),
    description: s.description,
    reasons: s.reasons,
    review: s.review ?? null,
    decidedBy: s.decidedBy ?? null,
    decidedAt: s.decidedAt ?? null,
    payoutBatchId: s.payoutBatchId ?? null,
    createdAt: s.createdAt,
    canDecide: s.status === "needs_approval" && m.status === "active",
  }));
}

export const spends = query({
  args: { mandateId: v.id("mandates") },
  handler: async (ctx, { mandateId }) => spendsFlow(ctx, await requireUserId(ctx), mandateId),
});

export const spendsAs = internalQuery({
  args: { userId: v.id("users"), mandateId: v.id("mandates") },
  handler: async (ctx, { userId, mandateId }) => spendsFlow(ctx, userId, mandateId),
});

// ---------------------------------------------------------------------------
// Funding
// ---------------------------------------------------------------------------

type BeginOrder =
  | { kind: "existing"; orderId: string; approveUrl: string }
  | { kind: "new"; amountCents: number; currency: string; title: string; requestId: string };

export const _beginOrder = internalMutation({
  args: { userId: v.id("users"), mandateId: v.id("mandates") },
  handler: async (ctx, { userId, mandateId }): Promise<BeginOrder> => {
    const m = await ctx.db.get(mandateId);
    if (!m || m.ownerId !== userId) fail("NOT_FOUND", "Mandate not found.");
    if (m.status === "funding" && m.funding?.orderId && m.funding.approveUrl) return { kind: "existing", orderId: m.funding.orderId, approveUrl: m.funding.approveUrl };
    if (m.status !== "awaiting_funding") fail("INVALID_STATE", `Mandate is ${m.status}.`);
    await rateLimit(ctx, `fund:${userId}`, LIMITS.createContract);
    const authorizationCents = authorizationAmount(m.policy.budgetCents, m.feeBps);
    await ctx.db.patch(m._id, {
      funding: {
        mode: "authorize",
        runtimeMode: "authorize",
        currency: m.policy.currency,
        authorizationCents,
        maxFeeCents: maxFee(m.policy.budgetCents, m.feeBps),
        captures: [],
      },
      updatedAt: Date.now(),
    });
    return { kind: "new", amountCents: authorizationCents, currency: m.policy.currency, title: m.policy.title, requestId: `mandate-order-${m._id}-${m.policyHash.slice(0, 16)}` };
  },
});

export const _recordOrder = internalMutation({
  args: { userId: v.id("users"), mandateId: v.id("mandates"), orderId: v.string(), approveUrl: v.string() },
  handler: async (ctx, a) => {
    const m = await ctx.db.get(a.mandateId);
    if (!m || !m.funding) fail("INVALID_STATE", "Funding was not initialized.");
    if (m.status === "funding" && m.funding.orderId === a.orderId) return;
    if (m.status !== "awaiting_funding") fail("INVALID_STATE", `Mandate is ${m.status}.`);
    await ctx.db.patch(m._id, { status: "funding", funding: { ...m.funding, orderId: a.orderId, approveUrl: a.approveUrl, orderCreatedAt: Date.now() }, updatedAt: Date.now() });
    await appendJournal(ctx, m._id, actorUser(a.userId), "funding.order_created", { orderId: a.orderId, amountCents: m.funding.authorizationCents });
  },
});

export const _orderInfo = internalQuery({
  args: { mandateId: v.id("mandates"), userId: v.optional(v.id("users")) },
  handler: async (ctx, { mandateId, userId }) => {
    const m = await ctx.db.get(mandateId);
    if (!m || (userId && m.ownerId !== userId)) fail("NOT_FOUND", "Mandate not found.");
    return { status: m.status, orderId: m.funding?.orderId ?? null };
  },
});

export const _byOrder = internalQuery({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    const m = await ctx.db.query("mandates").withIndex("by_order", (q) => q.eq("funding.orderId", orderId)).first();
    return m ? { mandateId: m._id, status: m.status } : null;
  },
});

export const _activate = internalMutation({
  args: { mandateId: v.id("mandates"), orderId: v.string(), authorizationId: v.string(), amountCents: v.number(), currency: v.string(), expiresAt: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const m = await ctx.db.get(a.mandateId);
    if (!m) fail("NOT_FOUND", "Mandate not found.");
    if (m.status === "active" || m.status === "closing" || m.status === "closed") return { status: m.status };
    if (m.status !== "funding" || !m.funding || m.funding.orderId !== a.orderId) fail("CONFLICT", "PayPal order does not belong to this mandate.");
    const now = Date.now();
    const authExpires = a.expiresAt ?? now + PAYPAL_RULES.authorizationValidHours * HOUR;
    const funding = {
      ...m.funding,
      authorizationId: a.authorizationId,
      authorizedAt: now,
      honorEndsAt: now + PAYPAL_RULES.honorPeriodHours * HOUR,
      expiresAt: authExpires,
    };
    if (a.amountCents !== m.funding.authorizationCents || a.currency !== m.funding.currency) {
      const reason = `Authorized ${a.amountCents} ${a.currency}, expected ${m.funding.authorizationCents} ${m.funding.currency}.`;
      await ctx.db.patch(m._id, { funding, status: "frozen", frozen: { reason, at: now, by: "system" }, updatedAt: now });
      await appendJournal(ctx, m._id, "system", "mandate.frozen", { reason });
      return { status: "frozen" };
    }
    const expiresAt = Math.min(now + m.policy.expiresAfterHours * HOUR, authExpires - HOUR);
    await ctx.db.patch(m._id, { funding, status: "active", activatedAt: now, expiresAt, ledger: { ...m.ledger, heldCents: m.policy.budgetCents }, updatedAt: now });
    await ctx.scheduler.runAt(expiresAt, internal.mandates.expire, { mandateId: m._id });
    await appendJournal(ctx, m._id, "paypal", "mandate.activated", { authorizationId: a.authorizationId, amountCents: a.amountCents, expiresAt });
    await notify(ctx, m.ownerId, { kind: "mandate.active", title: "Mandate is live", body: `${m.policy.title}: agents can now spend up to ${formatCents(m.policy.budgetCents, m.policy.currency)}.`, stream: m._id });
    return { status: "active" };
  },
});

async function fundStartFlow(ctx: ActionCtx, userId: Id<"users">, mandateId: Id<"mandates">): Promise<{ orderId: string; approveUrl: string }> {
  const prep: BeginOrder = await ctx.runMutation(internal.mandates._beginOrder, { userId, mandateId });
  if (prep.kind === "existing") return { orderId: prep.orderId, approveUrl: prep.approveUrl };
  const site = env.siteUrl();
  let order;
  try {
    order = await getRail().createOrder({
      intent: "AUTHORIZE",
      amountCents: prep.amountCents,
      currency: prep.currency,
      referenceId: mandateId,
      description: `Agent mandate: ${prep.title}`,
      returnUrl: `${site}/mandates/${mandateId}?funding=approved`,
      cancelUrl: `${site}/mandates/${mandateId}?funding=cancelled`,
      brandName: env.brandName(),
      requestId: prep.requestId,
    });
  } catch (e) {
    rethrowRail(e);
  }
  await ctx.runMutation(internal.mandates._recordOrder, { userId, mandateId, orderId: order.orderId, approveUrl: order.approveUrl });
  return { orderId: order.orderId, approveUrl: order.approveUrl };
}

async function fundConfirmFlow(ctx: ActionCtx, userId: Id<"users"> | null, mandateId: Id<"mandates">): Promise<{ status: string }> {
  const info: { status: string; orderId: string | null } = await ctx.runQuery(internal.mandates._orderInfo, { mandateId, userId: userId ?? undefined });
  if (info.status !== "funding") return { status: info.status };
  if (!info.orderId) fail("INVALID_STATE", "No PayPal order to confirm.");
  try {
    const a = await getRail().authorizeOrder(info.orderId, `authz-${info.orderId}`);
    if (a.status !== "CREATED" && a.status !== "PENDING") fail("PAYMENT_FAILED", `PayPal authorization is ${a.status}.`);
    return await ctx.runMutation(internal.mandates._activate, {
      mandateId,
      orderId: info.orderId,
      authorizationId: a.authorizationId,
      amountCents: a.amountCents,
      currency: a.currency,
      expiresAt: a.expiresAt ?? undefined,
    });
  } catch (e) {
    rethrowRail(e);
  }
}

export const fundStart = action({
  args: { mandateId: v.id("mandates") },
  handler: async (ctx, { mandateId }): Promise<{ orderId: string; approveUrl: string }> => fundStartFlow(ctx, await requireUserId(ctx), mandateId),
});
export const fundConfirm = action({
  args: { mandateId: v.id("mandates") },
  handler: async (ctx, { mandateId }): Promise<{ status: string }> => fundConfirmFlow(ctx, await requireUserId(ctx), mandateId),
});
export const fundStartAs = internalAction({
  args: { userId: v.id("users"), mandateId: v.id("mandates") },
  handler: async (ctx, { userId, mandateId }): Promise<{ orderId: string; approveUrl: string }> => fundStartFlow(ctx, userId, mandateId),
});
export const fundConfirmAs = internalAction({
  args: { userId: v.id("users"), mandateId: v.id("mandates") },
  handler: async (ctx, { userId, mandateId }): Promise<{ status: string }> => fundConfirmFlow(ctx, userId, mandateId),
});

export const confirmFromWebhook = internalAction({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }): Promise<boolean> => {
    const found: { mandateId: Id<"mandates">; status: string } | null = await ctx.runQuery(internal.mandates._byOrder, { orderId });
    if (!found) return false;
    if (found.status === "funding") await fundConfirmFlow(ctx, null, found.mandateId);
    return true;
  },
});

// ---------------------------------------------------------------------------
// Agent tokens
// ---------------------------------------------------------------------------

export const _insertToken = internalMutation({
  args: { userId: v.id("users"), mandateId: v.id("mandates"), label: v.string(), tokenHash: v.string(), prefix: v.string(), expiresInHours: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const m = await ctx.db.get(a.mandateId);
    if (!m || m.ownerId !== a.userId) fail("NOT_FOUND", "Mandate not found.");
    if (["closing", "closed", "revoked"].includes(m.status)) fail("INVALID_STATE", `Mandate is ${m.status}.`);
    await rateLimit(ctx, `token:${a.userId}`, LIMITS.secretIssue);
    const now = Date.now();
    const existing = await ctx.db.query("agentTokens").withIndex("by_mandate", (q) => q.eq("mandateId", m._id)).take(100);
    if (existing.filter((t) => !t.revokedAt && t.expiresAt > now).length >= MAX_TOKENS) fail("INVALID_STATE", `At most ${MAX_TOKENS} active tokens per mandate.`);
    const hours = Math.min(Math.max(a.expiresInHours ?? m.policy.expiresAfterHours, 1), PAYPAL_RULES.authorizationBudgetHours);
    const expiresAt = Math.min(now + hours * HOUR, m.expiresAt ?? Infinity, now + PAYPAL_RULES.authorizationBudgetHours * HOUR);
    const label = a.label.trim().slice(0, 80) || "agent";
    const tokenId = await ctx.db.insert("agentTokens", { mandateId: m._id, ownerId: a.userId, tokenHash: a.tokenHash, prefix: a.prefix, label, createdAt: now, expiresAt });
    await appendJournal(ctx, m._id, actorUser(a.userId), "token.issued", { tokenId, prefix: a.prefix, label, expiresAt });
    return { tokenId, expiresAt };
  },
});

async function issueTokenFlow(ctx: ActionCtx, userId: Id<"users">, mandateId: Id<"mandates">, label: string, expiresInHours?: number) {
  const secret = issueSecret("mt");
  const r: { tokenId: Id<"agentTokens">; expiresAt: number } = await ctx.runMutation(internal.mandates._insertToken, {
    userId,
    mandateId,
    label,
    tokenHash: secret.hash,
    prefix: secret.prefix,
    expiresInHours,
  });
  return { tokenId: r.tokenId, token: secret.token, prefix: secret.prefix, expiresAt: r.expiresAt, mcpUrl: `${env.convexSiteUrl()}/mcp`, agentApiUrl: `${env.convexSiteUrl()}/agent/v1` };
}

const tokenArgs = { mandateId: v.id("mandates"), label: v.string(), expiresInHours: v.optional(v.number()) };

/** Issue an agent token. The token is shown exactly once. */
export const issueToken = action({ args: tokenArgs, handler: async (ctx, a) => issueTokenFlow(ctx, await requireUserId(ctx), a.mandateId, a.label, a.expiresInHours) });
export const issueTokenAs = internalAction({ args: { userId: v.id("users"), ...tokenArgs }, handler: async (ctx, a) => issueTokenFlow(ctx, a.userId, a.mandateId, a.label, a.expiresInHours) });

export const revokeToken = mutation({
  args: { tokenId: v.id("agentTokens") },
  handler: async (ctx, { tokenId }) => {
    const userId = await requireUserId(ctx);
    const t = await ctx.db.get(tokenId);
    if (!t || t.ownerId !== userId) fail("NOT_FOUND", "Token not found.");
    if (t.revokedAt) return;
    await ctx.db.patch(t._id, { revokedAt: Date.now() });
    await appendJournal(ctx, t.mandateId, actorUser(userId), "token.revoked", { tokenId, prefix: t.prefix });
  },
});

// ---------------------------------------------------------------------------
// Spending (shared with agentApi.ts)
// ---------------------------------------------------------------------------

/**
 * Commit an approved purchase: update counters exactly as effects.ts expects
 * for rollback, then capture amount + fee and pay the merchant.
 */
export async function executeSpend(ctx: MutationCtx, m: Mandate, spend: Doc<"spends">, actor: Actor, fromReservation: boolean): Promise<void> {
  const now = Date.now();
  const fee = feeForRelease(m.spentCents, spend.amountCents, m.feeBps);
  await ctx.db.patch(m._id, {
    spentCents: m.spentCents + spend.amountCents,
    feesCents: m.feesCents + fee,
    purchases: m.purchases + 1,
    reservedCents: fromReservation ? Math.max(0, m.reservedCents - spend.amountCents) : m.reservedCents,
    recentSpendTimes: [...m.recentSpendTimes.filter((t) => now - t < HOUR), now],
    ledger: { ...m.ledger, heldCents: m.ledger.heldCents - spend.amountCents, releasedCents: m.ledger.releasedCents + spend.amountCents, feesCents: m.ledger.feesCents + fee },
    updatedAt: now,
  });
  await ctx.db.patch(spend._id, { status: "executing", feeCents: fee, decidedBy: actor, decidedAt: now, updatedAt: now });
  await postLedger(ctx, m._id, [
    { kind: "spend", cents: spend.amountCents, from: "hold", to: `merchant:${spend.merchantEmail}`, ref: spend._id },
    { kind: "fee", cents: fee, from: "fee_reserve", to: "platform", ref: spend._id },
  ]);
  await enqueueEffect(ctx, {
    stream: m._id,
    streamKind: "mandate",
    kind: "capture_authorization",
    params: {
      amountCents: spend.amountCents + fee,
      releaseCents: spend.amountCents,
      feeCents: fee,
      purpose: "spend",
      receiverEmail: spend.merchantEmail,
      spendId: spend._id,
      note: `${m.policy.title}: ${spend.description}`.slice(0, 200),
    },
    ref: spend._id,
  });
  await appendJournal(ctx, m._id, actor, "spend.approved", { spendId: spend._id, amountCents: spend.amountCents, feeCents: fee, merchant: maskEmail(spend.merchantEmail) });
}

/** Close a mandate: cancel pending approvals, then void the unused authorization. */
export async function closeMandate(ctx: MutationCtx, m: Mandate, reason: string, actor: Actor): Promise<void> {
  if (["closing", "closed", "revoked"].includes(m.status)) return;
  const now = Date.now();
  const open = await ctx.db.query("spends").withIndex("by_mandate", (q) => q.eq("mandateId", m._id)).take(500);
  let released = 0;
  for (const s of open) {
    if (s.status === "needs_approval" || s.status === "screening") {
      released += s.amountCents;
      await ctx.db.patch(s._id, { status: "cancelled", reasons: [...s.reasons, `Mandate closed: ${reason}`], updatedAt: now });
    }
  }
  const funded = Boolean(m.funding?.authorizationId);
  await ctx.db.patch(m._id, {
    status: funded ? "closing" : "revoked",
    reservedCents: Math.max(0, m.reservedCents - released),
    ...(funded ? {} : { closedAt: now }),
    updatedAt: now,
  });
  if (funded) await enqueueEffect(ctx, { stream: m._id, streamKind: "mandate", kind: "void_authorization", params: {}, ref: "close" });
  await appendJournal(ctx, m._id, actor, "mandate.closing", { reason, cancelledApprovals: released });
  await notify(ctx, m.ownerId, { kind: "mandate.closing", title: "Mandate closing", body: `${m.policy.title}: ${reason}`, stream: m._id });
}

async function decideSpendFlow(ctx: MutationCtx, userId: Id<"users">, spendId: Id<"spends">, approve: boolean, reason?: string) {
  const s = await ctx.db.get(spendId);
  if (!s) fail("NOT_FOUND", "Spend not found.");
  const m = await ownedMandate(ctx, userId, s.mandateId);
  if (m.ownerId !== userId) fail("FORBIDDEN", "Only the mandate owner can decide.");
  if (s.status !== "needs_approval") fail("INVALID_STATE", `Spend is ${s.status}.`);
  const now = Date.now();
  const decline = async (why: string) => {
    await ctx.db.patch(s._id, { status: "cancelled", reasons: [...s.reasons, why], decidedBy: actorUser(userId), decidedAt: now, updatedAt: now });
    await ctx.db.patch(m._id, { reservedCents: Math.max(0, m.reservedCents - s.amountCents), updatedAt: now });
    await appendJournal(ctx, m._id, actorUser(userId), "spend.declined", { spendId, reason: why.slice(0, 200) });
    return { status: "cancelled" as const };
  };
  if (!approve) return decline(reason?.trim() ? `Declined by owner: ${reason.trim().slice(0, 300)}` : "Declined by owner.");
  if (m.status !== "active") return decline(`Mandate is ${m.status}.`);
  // Re-check every limit at approval time (excluding this spend's own reservation).
  const ev = evaluateSpend(
    m.policy,
    { status: m.status, activatedAt: m.activatedAt ?? null, spentCents: m.spentCents, reservedCents: Math.max(0, m.reservedCents - s.amountCents), purchases: m.purchases, recentSpendTimes: m.recentSpendTimes },
    { amountCents: s.amountCents, currency: s.currency, merchantEmail: s.merchantEmail, description: s.description },
    now,
    m.feeBps,
  );
  if (ev.decision === "deny") return decline(`No longer within the mandate: ${ev.reasons.join("; ")}`);
  await executeSpend(ctx, m, s, actorUser(userId), true);
  return { status: "executing" as const };
}

export const decideSpend = mutation({
  args: { spendId: v.id("spends"), approve: v.boolean(), reason: v.optional(v.string()) },
  handler: async (ctx, a) => decideSpendFlow(ctx, await requireUserId(ctx), a.spendId, a.approve, a.reason),
});

export const decideSpendAs = internalMutation({
  args: { userId: v.id("users"), spendId: v.id("spends"), approve: v.boolean(), reason: v.optional(v.string()) },
  handler: async (ctx, a) => decideSpendFlow(ctx, a.userId, a.spendId, a.approve, a.reason),
});

async function revokeFlow(ctx: MutationCtx, userId: Id<"users">, mandateId: Id<"mandates">) {
  const m = await ownedMandate(ctx, userId, mandateId);
  if (m.ownerId !== userId) fail("FORBIDDEN", "Only the owner can revoke.");
  await closeMandate(ctx, m, "revoked by the owner", actorUser(userId));
  return { status: (await ctx.db.get(m._id))?.status ?? "closing" };
}

export const revoke = mutation({ args: { mandateId: v.id("mandates") }, handler: async (ctx, a) => revokeFlow(ctx, await requireUserId(ctx), a.mandateId) });
export const revokeAs = internalMutation({ args: { userId: v.id("users"), mandateId: v.id("mandates") }, handler: async (ctx, a) => revokeFlow(ctx, a.userId, a.mandateId) });

export const expire = internalMutation({
  args: { mandateId: v.id("mandates") },
  handler: async (ctx, { mandateId }) => {
    const m = await ctx.db.get(mandateId);
    if (m && m.status === "active" && (m.expiresAt ?? Infinity) <= Date.now()) await closeMandate(ctx, m, "expired", "system");
  },
});

/** Cron: close every active mandate past its expiry. */
export const expireDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const active = await ctx.db.query("mandates").withIndex("by_status", (q) => q.eq("status", "active")).take(500);
    for (const m of active) if ((m.expiresAt ?? Infinity) <= now) await closeMandate(ctx, m, "expired", "system");
  },
});
