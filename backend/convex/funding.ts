/**
 * Funding: create the PayPal order, then authorize (authorize mode) or
 * capture (escrow mode) once the funder approves it on PayPal.
 */
import { authorizationAmount, maxFee } from "@kept/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { loadContract, requireRole, requireUserId } from "./lib/authz";
import { env } from "./lib/env";
import { fail } from "./lib/errors";
import { actorUser, appendJournal } from "./lib/journal";
import { LIMITS, rateLimit } from "./lib/rateLimit";
import { getRail, toRailError } from "./rails";

/** Turn rail failures into client-visible errors. */
export function rethrowRail(e: unknown): never {
  if (e instanceof ConvexError) throw e;
  const r = toRailError(e);
  if (r.code === "ORDER_NOT_APPROVED" || r.code === "PAYER_ACTION_REQUIRED") {
    fail("INVALID_STATE", "Approve the payment on PayPal first, then confirm.");
  }
  fail("PAYMENT_FAILED", r.message, { paypalCode: r.code });
}

/**
 * Spend the authorize/capture idempotency key only once the buyer has approved. A call made before
 * approval fails with ORDER_NOT_APPROVED, and PayPal may keep that answer under the PayPal-Request-Id
 * and replay it after the buyer approves, which would leave the payment stuck. Asking first avoids that.
 */
export async function requireBuyerApproval(orderId: string): Promise<void> {
  const rail = getRail();
  if (rail.name !== "paypal") return;
  const o = await rail.getOrder(orderId);
  if (o.status === "APPROVED" || o.status === "COMPLETED") return;
  if (o.status === "VOIDED") fail("INVALID_STATE", "This PayPal payment was cancelled. Start funding again.");
  fail("INVALID_STATE", "Approve the payment on PayPal first, then confirm.");
}

const MAX_ABANDONED_ORDERS = 10;

/** `abandoned` plus `orderId` (when there is one), newest last, capped. */
function abandonOrder(abandoned: string[] | undefined, orderId: string | undefined): string[] | undefined {
  if (!orderId) return abandoned;
  return [...(abandoned ?? []).filter((x) => x !== orderId), orderId].slice(-MAX_ABANDONED_ORDERS);
}

export const _beginOrder = internalMutation({
  args: { contractId: v.id("contracts"), userId: v.id("users") },
  handler: async (ctx, { contractId, userId }) => {
    const c = await loadContract(ctx, contractId);
    requireRole(c, userId, ["funder"]);
    if (c.status === "funding" && c.funding?.orderId && c.funding.approveUrl) {
      return { kind: "existing" as const, orderId: c.funding.orderId, approveUrl: c.funding.approveUrl };
    }
    if (c.status !== "awaiting_funding") fail("INVALID_STATE", `Contract is ${c.status}; both parties must approve the verified terms first.`);
    if (c.funding?.authorizationId || (c.funding?.captures.length ?? 0) > 0) fail("INVALID_STATE", "PayPal already holds funds for this contract.");
    if (!c.ir || !c.termsHash || c.verification?.ok !== true || c.verification.irHash !== c.irHash) {
      fail("VERIFICATION_FAILED", "Terms are not verified.");
    }
    if (c.approvals.funder?.termsHash !== c.termsHash || c.approvals.payee?.termsHash !== c.termsHash) {
      fail("INVALID_STATE", "Both parties must approve the current terms.");
    }
    await rateLimit(ctx, `fund:${userId}`, LIMITS.createContract);
    const authorizationCents = authorizationAmount(c.ir.principalCents, c.feeBps);
    await ctx.db.patch(c._id, {
      funding: {
        mode: c.ir.fundingMode,
        runtimeMode: c.ir.fundingMode,
        currency: c.ir.currency,
        authorizationCents,
        maxFeeCents: maxFee(c.ir.principalCents, c.feeBps),
        captures: [],
        // Earlier checkouts (including one an arbiter resume left behind) stay recognizable: money PayPal still takes on them is returned.
        abandonedOrderIds: abandonOrder(c.funding?.abandonedOrderIds, c.funding?.orderId),
      },
      updatedAt: Date.now(),
    });
    return {
      kind: "new" as const,
      intent: c.ir.fundingMode === "authorize" ? ("AUTHORIZE" as const) : ("CAPTURE" as const),
      amountCents: authorizationCents,
      currency: c.ir.currency,
      title: c.ir.title,
      // Minute-bucketed so double clicks reuse one order, while a reset later gets a fresh one.
      requestId: `order-${c._id}-${c.termsHash.slice(0, 12)}-${Math.floor(Date.now() / 60_000)}`,
    };
  },
});

/**
 * Back to awaiting_funding after an abandoned (never approved) PayPal checkout.
 * The order is remembered: if PayPal still authorizes or captures it (a
 * confirmation already in flight), engine.activate returns the money.
 */
export const _resetOrder = internalMutation({
  args: { contractId: v.id("contracts"), userId: v.id("users"), orderId: v.string(), orderStatus: v.string() },
  handler: async (ctx, a) => {
    const c = await loadContract(ctx, a.contractId);
    requireRole(c, a.userId, ["funder"]);
    if (!c.funding) fail("INVALID_STATE", "Funding was not initialized.");
    if (c.status !== "funding" || c.funding.orderId !== a.orderId || c.funding.authorizationId || c.funding.captures.length || c.funding.pendingCapture) {
      fail("INVALID_STATE", "This funding attempt can no longer be reset.");
    }
    await ctx.db.patch(c._id, {
      status: "awaiting_funding",
      funding: {
        ...c.funding,
        orderId: undefined,
        approveUrl: undefined,
        orderCreatedAt: undefined,
        abandonedOrderIds: abandonOrder(c.funding.abandonedOrderIds, a.orderId),
      },
      updatedAt: Date.now(),
    });
    await appendJournal(ctx, c._id, actorUser(a.userId), "funding.reset", { orderId: a.orderId, orderStatus: a.orderStatus });
  },
});

export const _recordOrder = internalMutation({
  args: { contractId: v.id("contracts"), userId: v.id("users"), orderId: v.string(), approveUrl: v.string() },
  handler: async (ctx, a) => {
    const c = await loadContract(ctx, a.contractId);
    if (!c.funding) fail("INVALID_STATE", "Funding was not initialized.");
    if (c.status === "funding" && c.funding.orderId === a.orderId) return;
    if (c.status !== "awaiting_funding") fail("INVALID_STATE", `Contract is ${c.status}.`);
    await ctx.db.patch(c._id, {
      status: "funding",
      funding: { ...c.funding, orderId: a.orderId, approveUrl: a.approveUrl, orderCreatedAt: Date.now() },
      updatedAt: Date.now(),
    });
    await appendJournal(ctx, c._id, actorUser(a.userId), "funding.order_created", {
      orderId: a.orderId,
      amountCents: c.funding.authorizationCents,
      currency: c.funding.currency,
      mode: c.funding.mode,
    });
  },
});

export const _orderInfo = internalQuery({
  args: { contractId: v.id("contracts"), userId: v.optional(v.id("users")) },
  handler: async (ctx, { contractId, userId }) => {
    const c = await loadContract(ctx, contractId);
    if (userId) requireRole(c, userId, ["funder"]);
    return { status: c.status, orderId: c.funding?.orderId ?? null, mode: c.funding?.mode ?? null, pendingCaptureId: c.funding?.pendingCapture?.captureId ?? null };
  },
});

export const _contractByOrder = internalQuery({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    const c = await ctx.db
      .query("contracts")
      .withIndex("by_order", (q) => q.eq("funding.orderId", orderId))
      .first();
    return c ? { contractId: c._id, status: c.status } : null;
  },
});

type BeginOrder =
  | { kind: "existing"; orderId: string; approveUrl: string }
  | { kind: "new"; intent: "AUTHORIZE" | "CAPTURE"; amountCents: number; currency: string; title: string; requestId: string };

export interface FundingStarted {
  orderId: string;
  approveUrl: string;
}

export interface FundingConfirmed {
  status: string;
  /** Escrow payment is PENDING at PayPal: the contract starts once it clears. */
  pending?: boolean;
  /** PayPal took money on a checkout the contract no longer waits for; it is being returned. */
  returned?: boolean;
}

export async function startFunding(ctx: ActionCtx, userId: Id<"users">, contractId: Id<"contracts">): Promise<FundingStarted> {
  const prep: BeginOrder = await ctx.runMutation(internal.funding._beginOrder, { contractId, userId });
  if (prep.kind === "existing") return { orderId: prep.orderId, approveUrl: prep.approveUrl };
  const site = env.siteUrl();
  let order;
  try {
    order = await getRail().createOrder({
      intent: prep.intent,
      amountCents: prep.amountCents,
      currency: prep.currency,
      referenceId: contractId,
      description: prep.title,
      returnUrl: `${site}/contracts/${contractId}?funding=approved`,
      cancelUrl: `${site}/contracts/${contractId}?funding=cancelled`,
      brandName: env.brandName(),
      requestId: prep.requestId,
    });
  } catch (e) {
    rethrowRail(e);
  }
  await ctx.runMutation(internal.funding._recordOrder, { contractId, userId, orderId: order.orderId, approveUrl: order.approveUrl });
  return { orderId: order.orderId, approveUrl: order.approveUrl };
}

/** Authorize or capture the approved order, then activate the contract. Idempotent. */
export async function confirmFunding(ctx: ActionCtx, userId: Id<"users"> | null, contractId: Id<"contracts">): Promise<FundingConfirmed> {
  const info: { status: string; orderId: string | null; mode: "authorize" | "escrow" | null; pendingCaptureId: string | null } = await ctx.runQuery(
    internal.funding._orderInfo,
    { contractId, userId: userId ?? undefined },
  );
  if (info.status !== "funding") return { status: info.status };
  if (!info.orderId || !info.mode) fail("INVALID_STATE", "No PayPal order to confirm.");
  const rail = getRail();
  try {
    if (info.pendingCaptureId) {
      // Escrow payment was PENDING: check whether it has cleared.
      const cap = await rail.getCapture(info.pendingCaptureId);
      if (cap.status === "DECLINED" || cap.status === "FAILED") fail("PAYMENT_FAILED", `PayPal capture is ${cap.status}.`);
      if (cap.status !== "COMPLETED") return { status: "funding", pending: true };
      return await ctx.runMutation(internal.engine.activate, {
        contractId,
        orderId: info.orderId,
        captureId: cap.captureId,
        paypalStatus: "COMPLETED",
        amountCents: cap.amountCents,
        currency: cap.currency,
      });
    }
    await requireBuyerApproval(info.orderId);
    if (info.mode === "authorize") {
      const a = await rail.authorizeOrder(info.orderId, `authz-${info.orderId}`);
      if (a.status !== "CREATED" && a.status !== "PENDING") fail("PAYMENT_FAILED", `PayPal authorization is ${a.status}.`);
      return await ctx.runMutation(internal.engine.activate, {
        contractId,
        orderId: info.orderId,
        authorizationId: a.authorizationId,
        paypalStatus: a.status,
        amountCents: a.amountCents,
        currency: a.currency,
        expiresAt: a.expiresAt ?? undefined,
      });
    }
    const cap = await rail.captureOrder(info.orderId, `capture-${info.orderId}`);
    if (cap.status !== "COMPLETED" && cap.status !== "PENDING") fail("PAYMENT_FAILED", `PayPal capture is ${cap.status}.`);
    return await ctx.runMutation(internal.engine.activate, {
      contractId,
      orderId: info.orderId,
      captureId: cap.captureId,
      paypalStatus: cap.status,
      amountCents: cap.amountCents,
      currency: cap.currency,
    });
  } catch (e) {
    rethrowRail(e);
  }
}

/** Funder: create the PayPal order and get the approval link. */
export const start = action({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }): Promise<FundingStarted> => startFunding(ctx, await requireUserId(ctx), contractId),
});

/** Funder: after approving on PayPal, confirm to authorize/capture and go live. */
export const confirm = action({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }): Promise<FundingConfirmed> => confirmFunding(ctx, await requireUserId(ctx), contractId),
});

async function resetFlow(ctx: ActionCtx, userId: Id<"users">, contractId: Id<"contracts">): Promise<{ status: string }> {
  const info: { status: string; orderId: string | null } = await ctx.runQuery(internal.funding._orderInfo, { contractId, userId });
  if (info.status !== "funding" || !info.orderId) return { status: info.status };
  let orderStatus: string;
  try {
    orderStatus = (await getRail().getOrder(info.orderId)).status;
  } catch (e) {
    rethrowRail(e);
  }
  // Only an order the buyer never approved may be abandoned; an approved one must be confirmed instead.
  if (orderStatus === "APPROVED" || orderStatus === "COMPLETED") fail("INVALID_STATE", "The PayPal payment was approved. Confirm funding instead.");
  await ctx.runMutation(internal.funding._resetOrder, { contractId, userId, orderId: info.orderId, orderStatus });
  return { status: "awaiting_funding" };
}

/** Funder: abandon a PayPal checkout that was never approved (then cancel or fund again). */
export const reset = action({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }): Promise<{ status: string }> => resetFlow(ctx, await requireUserId(ctx), contractId),
});

export const startAs = internalAction({
  args: { userId: v.id("users"), contractId: v.id("contracts") },
  handler: async (ctx, { userId, contractId }): Promise<FundingStarted> => startFunding(ctx, userId, contractId),
});

export const confirmAs = internalAction({
  args: { userId: v.id("users"), contractId: v.id("contracts") },
  handler: async (ctx, { userId, contractId }): Promise<FundingConfirmed> => confirmFunding(ctx, userId, contractId),
});

export const resetAs = internalAction({
  args: { userId: v.id("users"), contractId: v.id("contracts") },
  handler: async (ctx, { userId, contractId }): Promise<{ status: string }> => resetFlow(ctx, userId, contractId),
});

/** PayPal says the buyer approved (CHECKOUT.ORDER.APPROVED): confirm even if the tab was closed. */
export const confirmFromWebhook = internalAction({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }): Promise<boolean> => {
    const found = await ctx.runQuery(internal.funding._contractByOrder, { orderId });
    if (!found) return false;
    if (found.status === "funding") await confirmFunding(ctx, null, found.contractId);
    return true;
  },
});
