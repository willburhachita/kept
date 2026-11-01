/**
 * Inbound PayPal webhooks (already signature-verified by routes/paypal.ts).
 * Idempotent by event id. Webhooks never move money on their own: they
 * confirm what our outbox already asked for, release payouts parked on
 * PENDING captures, start escrow contracts whose PENDING funding cleared,
 * or freeze a stream when PayPal reports a problem.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { activatePendingEscrow, freezeStream, releaseDeferredPayout } from "./effects";
import { appendJournal } from "./lib/journal";
import { notify, notifyStaff } from "./lib/notify";
import { findEffectByRef } from "./lib/outbox";

type Resource = Record<string, any>;

/** What ingest tells routes/paypal.ts. `retry`: answer 503 so PayPal redelivers; the event was not recorded. */
export type IngestResult = { duplicate: boolean; status: "processed" | "ignored" | "failed" | "retry"; retry?: boolean };

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

/** The PayPal order a capture belongs to (capture resources carry it in supplementary_data). */
function orderIdOf(r: Resource): string | null {
  const id = r?.supplementary_data?.related_ids?.order_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

async function knownStream(ctx: MutationCtx, stream: string | null): Promise<boolean> {
  if (!stream) return false;
  const cid = ctx.db.normalizeId("contracts", stream);
  if (cid) return (await ctx.db.get(cid)) !== null;
  const mid = ctx.db.normalizeId("mandates", stream);
  return mid ? (await ctx.db.get(mid)) !== null : false;
}

/**
 * PAYMENT.CAPTURE.COMPLETED: start the escrow contract whose PENDING funding
 * capture cleared, or release payouts parked on a PENDING capture. "retry"
 * when a stream we know does not have the capture yet: the webhook beat our
 * own write (effect completion or activation), so PayPal should redeliver.
 */
async function captureCompleted(ctx: MutationCtx, captureId: string, orderId: string | null, stream: string | null, known: boolean): Promise<"processed" | "ignored" | "retry"> {
  if (orderId) {
    const c = await ctx.db
      .query("contracts")
      .withIndex("by_order", (q) => q.eq("funding.orderId", orderId))
      .first();
    if (c?.funding?.pendingCapture?.captureId === captureId) return (await activatePendingEscrow(ctx, c._id, captureId)) ? "processed" : "ignored";
  }
  if (!known || !stream) return "ignored";
  // Same check by the stream the capture names (custom_id), for payloads without related ids.
  if (await activatePendingEscrow(ctx, stream, captureId)) return "processed";
  if (await releaseDeferredPayout(ctx, stream, captureId)) return "processed";
  // A stray capture (returnStrayFunds) is refunded, never recorded on the stream.
  if (await findEffectByRef(ctx, stream, `stray:${captureId}`)) return "ignored";
  return "retry";
}

export const ingest = internalMutation({
  args: { eventId: v.string(), type: v.string(), resource: v.any() },
  handler: async (ctx, { eventId, type, resource }): Promise<IngestResult> => {
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
      case "PAYMENT.CAPTURE.COMPLETED": {
        if (!resourceId) break;
        const outcome = await captureCompleted(ctx, resourceId, orderIdOf(r), stream, known);
        // Nothing was written: leave the event unrecorded so the redelivery is not deduped.
        if (outcome === "retry") return { duplicate: false, status: "retry", retry: true };
        status = outcome;
        break;
      }
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
