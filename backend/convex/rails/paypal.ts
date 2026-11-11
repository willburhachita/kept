/**
 * PayPal REST rail (Orders v2, Payments v2, Payouts v1, Webhooks v1).
 *
 * Every mutating call carries a PayPal-Request-Id derived from our outbox
 * effect id, so retries after timeouts are idempotent: PayPal returns the
 * original result instead of moving money twice.
 */
import { centsToDecimalString, decimalStringToCents } from "@kept/core";
import { env } from "../lib/env";
import {
  RailError,
  type AuthorizationResult,
  type CaptureResult,
  type CreateOrderInput,
  type OrderCreated,
  type OrderInfo,
  type PaymentRail,
  type PayoutResult,
} from "./types";

interface Money {
  currency_code: string;
  value: string;
}
interface Link {
  href: string;
  rel: string;
}
interface PPAuthorization {
  id: string;
  status: string;
  amount?: Money;
  expiration_time?: string;
}
interface PPCapture {
  id: string;
  status: string;
  amount?: Money;
}
interface PPOrder {
  id: string;
  status: string;
  links?: Link[];
  purchase_units?: {
    reference_id?: string;
    amount?: Money;
    payments?: { authorizations?: PPAuthorization[]; captures?: PPCapture[] };
  }[];
}

const TIMEOUT_MS = 30_000;
let tokenCache: { key: string; token: string; expiresAt: number } | null = null;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function accessToken(): Promise<string> {
  const cfg = env.paypal();
  const key = `${cfg.baseUrl}|${cfg.clientId}`;
  if (tokenCache && tokenCache.key === key && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  let res: Response;
  try {
    res = await fetchWithTimeout(`${cfg.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
  } catch (e) {
    throw new RailError(`PayPal unreachable: ${e instanceof Error ? e.message : String(e)}`, { retryable: true, code: "NETWORK" });
  }
  if (!res.ok) {
    throw new RailError(`PayPal OAuth failed (${res.status})`, {
      retryable: res.status >= 500 || res.status === 429,
      code: "PAYPAL_AUTH",
      status: res.status,
    });
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { key, token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function call<T>(method: "GET" | "POST", path: string, opts: { body?: unknown; requestId?: string } = {}, retriedAuth = false): Promise<T> {
  const cfg = env.paypal();
  const token = await accessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
  let res: Response;
  try {
    res = await fetchWithTimeout(cfg.baseUrl + path, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (e) {
    // Ambiguous outcome. Safe to retry: the same PayPal-Request-Id returns the original result.
    throw new RailError(`PayPal ${method} ${path} did not complete: ${e instanceof Error ? e.message : String(e)}`, {
      retryable: true,
      code: "NETWORK",
    });
  }
  const text = await res.text();
  let json: Record<string, any> | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (res.status === 401) {
    // The cached token was revoked or expired early (e.g. the app's secret was rotated): get a fresh one
    // and try once more. Safe for mutating calls: they carry the same PayPal-Request-Id.
    tokenCache = null;
    if (!retriedAuth) return call<T>(method, path, opts, true);
    throw new RailError("PayPal rejected the access token. Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox app, not live).", { retryable: true, code: "PAYPAL_AUTH", status: 401 });
  }
  if (!res.ok) {
    const detail = json?.details?.[0];
    const issue: string = detail?.issue ?? json?.name ?? "PAYPAL_ERROR";
    const description: string = detail?.description ?? json?.message ?? text.slice(0, 300);
    throw new RailError(`PayPal ${method} ${path} failed (${res.status} ${issue}): ${description}`, {
      retryable: res.status >= 500 || res.status === 429 || res.status === 408,
      code: issue,
      status: res.status,
      details: {
        debugId: json?.debug_id ?? null,
        name: json?.name ?? null,
        message: json?.message ?? null,
        field: detail?.field ?? null,
        links: [...(json?.links ?? []), ...(detail?.link ? [detail.link] : []), ...(detail?.links ?? [])],
      },
    });
  }
  return (json ?? {}) as T;
}

function cents(m: Money | undefined): number {
  return m ? decimalStringToCents(m.value) : 0;
}

function toAuthorization(a: PPAuthorization | undefined, fallbackCurrency: string): AuthorizationResult {
  if (!a) throw new RailError("PayPal response had no authorization", { retryable: false, code: "NO_AUTHORIZATION" });
  return {
    authorizationId: a.id,
    status: a.status,
    amountCents: cents(a.amount),
    currency: a.amount?.currency_code ?? fallbackCurrency,
    expiresAt: a.expiration_time ? Date.parse(a.expiration_time) : null,
  };
}

function toCapture(c: PPCapture | undefined, fallbackCurrency: string): CaptureResult {
  if (!c) throw new RailError("PayPal response had no capture", { retryable: false, code: "NO_CAPTURE" });
  return { captureId: c.id, status: c.status, amountCents: cents(c.amount), currency: c.amount?.currency_code ?? fallbackCurrency };
}

export const paypalRail: PaymentRail = {
  name: "paypal",

  async createOrder(i: CreateOrderInput): Promise<OrderCreated> {
    const order = await call<PPOrder>("POST", "/v2/checkout/orders", {
      requestId: i.requestId,
      body: {
        intent: i.intent,
        purchase_units: [
          {
            reference_id: i.referenceId,
            custom_id: i.referenceId,
            description: i.description.slice(0, 127),
            amount: { currency_code: i.currency, value: centsToDecimalString(i.amountCents) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: i.brandName.slice(0, 127),
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
              return_url: i.returnUrl,
              cancel_url: i.cancelUrl,
            },
          },
        },
      },
    });
    const approveUrl = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
    if (!approveUrl) throw new RailError("PayPal order has no approval link", { retryable: false, code: "NO_APPROVAL_LINK" });
    return { orderId: order.id, approveUrl, status: order.status };
  },

  async getOrder(orderId: string): Promise<OrderInfo> {
    const o = await call<PPOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    const pu = o.purchase_units?.[0];
    return {
      orderId: o.id,
      status: o.status,
      amountCents: cents(pu?.amount),
      currency: pu?.amount?.currency_code ?? "USD",
      referenceId: pu?.reference_id ?? null,
    };
  },

  async authorizeOrder(orderId: string, requestId: string): Promise<AuthorizationResult> {
    const o = await call<PPOrder>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, { body: {}, requestId });
    const pu = o.purchase_units?.[0];
    return toAuthorization(pu?.payments?.authorizations?.[0], pu?.amount?.currency_code ?? "USD");
  },

  async captureOrder(orderId: string, requestId: string): Promise<CaptureResult> {
    const o = await call<PPOrder>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { body: {}, requestId });
    const pu = o.purchase_units?.[0];
    return toCapture(pu?.payments?.captures?.[0], pu?.amount?.currency_code ?? "USD");
  },

  async captureAuthorization(i): Promise<CaptureResult> {
    const c = await call<PPCapture>("POST", `/v2/payments/authorizations/${encodeURIComponent(i.authorizationId)}/capture`, {
      requestId: i.requestId,
      body: {
        amount: { currency_code: i.currency, value: centsToDecimalString(i.amountCents) },
        final_capture: i.finalCapture,
        invoice_id: i.invoiceId,
        ...(i.noteToPayer ? { note_to_payer: i.noteToPayer.slice(0, 255) } : {}),
      },
    });
    return toCapture(c, i.currency);
  },

  async reauthorize(i): Promise<AuthorizationResult> {
    const a = await call<PPAuthorization>("POST", `/v2/payments/authorizations/${encodeURIComponent(i.authorizationId)}/reauthorize`, {
      requestId: i.requestId,
      body: { amount: { currency_code: i.currency, value: centsToDecimalString(i.amountCents) } },
    });
    return toAuthorization(a, i.currency);
  },

  async voidAuthorization(i): Promise<{ status: string }> {
    const r = await call<{ status?: string }>("POST", `/v2/payments/authorizations/${encodeURIComponent(i.authorizationId)}/void`, {
      requestId: i.requestId,
    });
    return { status: r.status ?? "VOIDED" };
  },

  async refundCapture(i): Promise<{ refundId: string; status: string }> {
    const r = await call<{ id: string; status: string }>("POST", `/v2/payments/captures/${encodeURIComponent(i.captureId)}/refund`, {
      requestId: i.requestId,
      body: {
        amount: { currency_code: i.currency, value: centsToDecimalString(i.amountCents) },
        ...(i.note ? { note_to_payer: i.note.slice(0, 255) } : {}),
        ...(i.invoiceId ? { invoice_id: i.invoiceId } : {}),
      },
    });
    return { refundId: r.id, status: r.status };
  },

  async payout(i): Promise<PayoutResult> {
    try {
      const r = await call<{ batch_header: { payout_batch_id: string; batch_status: string } }>("POST", "/v1/payments/payouts", {
        requestId: i.requestId,
        body: {
          sender_batch_header: {
            sender_batch_id: i.senderBatchId,
            recipient_type: "EMAIL",
            email_subject: i.subject.slice(0, 255),
            email_message: i.note.slice(0, 1000),
          },
          items: [
            {
              recipient_type: "EMAIL",
              receiver: i.receiverEmail,
              amount: { currency: i.currency, value: centsToDecimalString(i.amountCents) },
              note: i.note.slice(0, 4000),
              sender_item_id: i.senderItemId,
            },
          ],
        },
      });
      return { payoutBatchId: r.batch_header.payout_batch_id, status: r.batch_header.batch_status };
    } catch (e) {
      // PayPal rejects a reused sender_batch_id and links the original payout: that means our
      // earlier attempt went through, so recover its id instead of paying twice.
      if (e instanceof RailError) {
        const d = (e.details ?? {}) as { links?: (Link | string)[]; field?: string | null; message?: string | null; name?: string | null };
        const duplicate =
          /DUPLICATE|ALREADY_EXISTS/i.test(e.code) ||
          /sender_batch_id/i.test(String(d.field ?? "")) ||
          /already (been )?(used|exists)|duplicate/i.test(`${d.message ?? ""} ${e.message}`);
        if (duplicate) {
          const hrefs = (d.links ?? []).map((l) => (typeof l === "string" ? l : l?.href)).filter((h): h is string => typeof h === "string");
          const href = hrefs.find((h) => /\/v1\/payments\/payouts\/[^/?]+/.test(h));
          const id = href?.split("/payouts/")[1]?.split(/[/?]/)[0];
          if (id) return { payoutBatchId: id, status: "DUPLICATE_RECOVERED" };
          // Duplicate without a link: our earlier request went through; surface as permanent so an arbiter checks it.
          throw new RailError(`PayPal reports payout ${i.senderBatchId} already exists`, { retryable: false, code: "PAYOUT_DUPLICATE_UNLINKED" });
        }
      }
      throw e;
    }
  },

  async getPayoutBatch(payoutBatchId: string) {
    const r = await call<{
      batch_header: { batch_status: string };
      items?: { payout_item_id: string; transaction_status: string }[];
    }>("GET", `/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`);
    return {
      status: r.batch_header.batch_status,
      items: (r.items ?? []).map((it) => ({ payoutItemId: it.payout_item_id, status: it.transaction_status })),
    };
  },

  async getCapture(captureId: string): Promise<CaptureResult> {
    const c = await call<PPCapture>("GET", `/v2/payments/captures/${encodeURIComponent(captureId)}`);
    return toCapture(c, "USD");
  },

  async verifyWebhook(headers, event): Promise<boolean> {
    const cfg = env.paypal();
    if (!cfg.webhookId) return false;
    const h = (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null;
    const body = {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: cfg.webhookId,
      webhook_event: event,
    };
    if (!body.auth_algo || !body.cert_url || !body.transmission_id || !body.transmission_sig || !body.transmission_time) return false;
    const r = await call<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", { body });
    return r.verification_status === "SUCCESS";
  },
};
