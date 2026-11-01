/**
 * Inbound PayPal webhooks (already signature-verified by routes/paypal.ts).
 * Idempotent by event id. Webhooks never move money on their own: they
 * confirm what our outbox already asked for, release payouts parked on
 * PENDING captures, or freeze a stream when PayPal reports a problem.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { releaseDeferredPayout } from "./effects";
import { freezeContract } from "./engine";
import { appendJournal } from "./lib/journal";
import { notify, notifyStaff } from "./lib/notify";

type Resource = Record<string, any>;

/** Our invoice/sender ids are `${stream}-${seq}`; custom_id is the stream itself. */
function streamOf(r: Resource): string | null {
  const candidates = [
    r?.invoice_id,
    r?.payout_item?.sender_item_id,
    r?.custom_id,
    r?.disputed_transactions?.[0]?.invoice_number,
    r?.disputed_transactions?.[0]?.custom,
  ].filter((x): x is string => typeof x === "string" && x.length > 0);
  for (const c of candidates) {
    const i = c.lastIndexOf("-");
    return i > 0 && /^\d+$/.test(c.slice(i + 1)) ? c.slice(0, i) : c;
  }
  return null;
}

async function freezeStream(ctx: MutationCtx, stream: string, reason: string): Promise<boolean> {
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

async function knownStream(ctx: MutationCtx, stream: string | null): Promise<boolean> {
  if (!stream) return false;
  const cid = ctx.db.normalizeId("contracts", stream);
  if (cid) return (await ctx.db.get(cid)) !== null;
  const mid = ctx.db.normalizeId("mandates", stream);
  return mid ? (await ctx.db.get(mid)) !== null : false;
}

export const ingest = internalMutation({
  args: { eventId: v.string(), type: v.string(), resource: v.any() },
  handler: async (ctx, { eventId, type, resource }) => {
    const seen = await ctx.db.query("webhookEvents").withIndex("by_event", (q) => q.eq("eventId", eventId)).unique();
    if (seen) return { duplicate: true, status: seen.status };
    const r = (resource ?? {}) as Resource;
    const resourceId = typeof r.id === "string" ? r.id : undefined;
    const stream = streamOf(r);
    const known = await knownStream(ctx, stream);
    let status: "processed" | "ignored" | "failed" = "ignored";
    let note: string | undefined;

    switch (type) {
      case "CHECKOUT.ORDER.APPROVED":
        if (resourceId) {
          await ctx.scheduler.runAfter(0, internal.webhooks.confirmOrder, { orderId: resourceId });
          status = "processed";
        }
        break;
      case "PAYMENT.CAPTURE.COMPLETED":
        if (known && stream && resourceId) status = (await releaseDeferredPayout(ctx, stream, resourceId)) ? "processed" : "ignored";
        break;
      case "PAYMENT.CAPTURE.DENIED":
      case "PAYMENT.CAPTURE.REVERSED":
      case "CUSTOMER.DISPUTE.CREATED": {
        const reason = type === "CUSTOMER.DISPUTE.CREATED" ? "The buyer opened a PayPal dispute." : `PayPal reported ${type.split(".").pop()?.toLowerCase()} on a capture.`;
        if (known && stream && (await freezeStream(ctx, stream, reason))) status = "processed";
        else {
          status = "failed";
          note = "Could not map the event to a contract or mandate.";
          await notifyStaff(ctx, { kind: "paypal.unmapped", title: `Unmapped PayPal ${type}`, body: `Event ${eventId}`, stream: undefined });
        }
        break;
      }
      case "PAYMENT.PAYOUTS-ITEM.FAILED":
      case "PAYMENT.PAYOUTS-ITEM.BLOCKED":
      case "PAYMENT.PAYOUTS-ITEM.RETURNED":
      case "PAYMENT.PAYOUTS-ITEM.UNCLAIMED":
      case "PAYMENT.PAYOUTS-ITEM.DENIED": {
        status = known ? "processed" : "failed";
        if (known && stream) {
          const cid = ctx.db.normalizeId("contracts", stream);
          const c = cid ? await ctx.db.get(cid) : null;
          const what = type.split(".").pop()!.toLowerCase();
          if (c) await notify(ctx, c.payeeId, { kind: "payout.problem", title: `Payout ${what}`, body: "Check that your PayPal payout email is correct and can receive payments.", stream });
          await notifyStaff(ctx, { kind: "payout.problem", title: `Payout ${what}`, body: `Stream ${stream}`, stream });
        }
        break;
      }
      default:
        break;
    }

    if (known && stream) {
      await appendJournal(ctx, stream, "paypal", `paypal.webhook.${type}`, { eventId, resourceId: resourceId ?? null, status: r.status ?? null, handled: status });
    }
    await ctx.db.insert("webhookEvents", { eventId, type, receivedAt: Date.now(), status, resourceId, note });
    return { duplicate: false, status };
  },
});

/** The buyer approved an order on PayPal: confirm it (contract first, then mandate). */
export const confirmOrder = internalAction({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    const contract: boolean = await ctx.runAction(internal.funding.confirmFromWebhook, { orderId });
    if (!contract) await ctx.runAction(internal.mandates.confirmFromWebhook, { orderId });
  },
});
