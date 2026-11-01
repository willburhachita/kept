/**
 * PayPal webhook receiver. Signature verification happens first, through
 * PayPal's verify-webhook-signature API; unverified events are dropped.
 * Configure the webhook in the PayPal developer dashboard to point at
 *   https://<deployment>.convex.site/paypal/webhook
 * and set PAYPAL_WEBHOOK_ID.
 */
import type { HttpRouter } from "convex/server";
import { internal } from "../_generated/api";
import { httpAction } from "../_generated/server";
import { getRail } from "../rails";
import { json } from "./public";

const HEADERS = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];

export function registerPaypalWebhooks(http: HttpRouter): void {
  http.route({
    path: "/paypal/webhook",
    method: "POST",
    handler: httpAction(async (ctx, req) => {
      const raw = await req.text();
      if (raw.length > 512 * 1024) return json(413, { error: "payload too large" });
      let event: { id?: unknown; event_type?: unknown; resource?: unknown };
      try {
        event = JSON.parse(raw);
      } catch {
        return json(400, { error: "invalid json" });
      }
      if (typeof event.id !== "string" || typeof event.event_type !== "string") return json(400, { error: "not a PayPal event" });
      const headers: Record<string, string | null> = {};
      for (const h of HEADERS) headers[h] = req.headers.get(h);
      let verified = false;
      try {
        verified = await getRail().verifyWebhook(headers, event);
      } catch (e) {
        console.error("PayPal webhook verification error:", e instanceof Error ? e.message : String(e));
      }
      if (!verified) return json(400, { error: "signature verification failed" });
      const r = await ctx.runMutation(internal.webhooks.ingest, { eventId: event.id, type: event.event_type, resource: event.resource ?? {} });
      // The event got ahead of our own write and was not recorded: a non-2xx answer makes PayPal redeliver it later.
      if (r.retry) return json(503, { received: false, retry: true });
      return json(200, { received: true, ...r });
    }),
  });
}
