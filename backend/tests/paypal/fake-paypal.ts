/**
 * A stand-in for the PayPal sandbox that holds Kept to PayPal's own published contract.
 *
 * Every request Kept sends is validated against PayPal's official OpenAPI specifications
 * (github.com/paypal/paypal-rest-api-specifications, vendored in ./specs with their licence),
 * and so is every response this fake returns, so a test can't pass against answers real
 * PayPal would never give. On top of the shapes, it enforces the PayPal behaviour that
 * integrations most often trip over in the sandbox:
 *
 *   - an order needs buyer approval before it can be authorized (422 ORDER_NOT_APPROVED)
 *   - captures can't exceed what is still held (422 MAX_CAPTURE_AMOUNT_EXCEEDED)
 *   - a fully captured authorization can't be voided or captured again (422 PREVIOUSLY_CAPTURED)
 *   - an expired authorization can't be captured (422 AUTHORIZATION_EXPIRED)
 *   - an invoice_id can only be used once per merchant (422 DUPLICATE_INVOICE_ID)
 *   - refunds can't exceed the capture (422 REFUND_AMOUNT_EXCEEDED)
 *   - PayPal-Request-Id makes a retried call return the original result
 *   - a reused payout sender_batch_id is rejected with a link to the original batch
 *   - payouts to an email with no PayPal account end UNCLAIMED, as in the sandbox
 *   - Payouts needs its own permission on the REST app (403 without it)
 *
 * It also injects the failures that real networks produce: a timeout after PayPal already
 * moved the money, so the test can prove that retries never move money twice.
 */
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";

export const SANDBOX = "https://api-m.sandbox.paypal.com";
const SPEC_DIR = new URL("./specs/", import.meta.url);
const SPECS = { orders: "checkout_orders_v2.json", payments: "payments_payment_v2.json", payouts: "payments_payouts_batch_v1.json", webhooks: "notifications_webhooks_v1.json" } as const;
type SpecName = keyof typeof SPECS;

// ---------- spec loading and validation (compiled once per process)
type Json = Record<string, any>;
let shared: { ajv: Ajv; specs: Record<SpecName, Json>; cache: Map<string, ValidateFunction | null> } | null = null;
function specs() {
  if (shared) return shared;
  const ajv = new Ajv({ strict: false, allErrors: true, validateSchema: false, logger: false, unicodeRegExp: false }); // PayPal's patterns are written for non-unicode RegExp
  addFormats(ajv);
  ajv.addFormat("ppaas_common_language_v3", true); // PayPal's language-tag format; not checked by ajv-formats
  const loaded = {} as Record<SpecName, Json>;
  for (const [name, file] of Object.entries(SPECS) as [SpecName, string][]) {
    loaded[name] = JSON.parse(readFileSync(new URL(file, SPEC_DIR), "utf8"));
    ajv.addSchema(loaded[name], name);
  }
  shared = { ajv, specs: loaded, cache: new Map() };
  return shared;
}
const esc = (s: string) => encodeURIComponent(s.replace(/~/g, "~0").replace(/\//g, "~1"));
function deref(spec: Json, node: Json | undefined): { node: Json | undefined; ptr: string | null } {
  if (node && typeof node.$ref === "string") {
    const ptr = node.$ref.slice(1);
    let n: any = spec;
    for (const seg of ptr.split("/").slice(1)) n = n?.[seg.replace(/~1/g, "/").replace(/~0/g, "~")];
    return { node: n, ptr };
  }
  return { node, ptr: null };
}
/** Validator for a request body or a response body of one operation, or null if the spec defines none. */
function validator(spec: SpecName, path: string, method: string, kind: "request" | "response", status?: number): ValidateFunction | null {
  const key = `${spec} ${method} ${path} ${kind} ${status ?? ""}`;
  const { ajv, specs: all, cache } = specs();
  if (cache.has(key)) return cache.get(key)!;
  const doc = all[spec];
  const opPtr = `/paths/${esc(path)}/${method}`;
  const op = doc.paths?.[path]?.[method];
  let v: ValidateFunction | null = null;
  if (op) {
    let base: string | null;
    let node: Json | undefined;
    if (kind === "request") {
      ({ node, ptr: base } = deref(doc, op.requestBody));
      base ??= `${opPtr}/requestBody`;
    } else {
      const code = op.responses?.[String(status)] ? String(status) : op.responses?.default ? "default" : null;
      if (code) {
        ({ node, ptr: base } = deref(doc, op.responses[code]));
        base ??= `${opPtr}/responses/${code}`;
      } else base = null;
    }
    if (node?.content?.["application/json"]?.schema && base) v = ajv.getSchema(`${spec}#${base}/content/${esc("application/json")}/schema`) ?? null;
  }
  cache.set(key, v);
  return v;
}

// ---------- the fake
type Money = { currency_code: string; value: string };
const cents = (m: { value: string }) => Math.round(Number(m.value) * 100);
const dec = (c: number) => (c / 100).toFixed(2);
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const DAY = 86_400_000;

interface Order { id: string; intent: string; status: string; amount: Money; reference_id: string; custom_id?: string; description?: string; returnUrl: string; cancelUrl: string; created: number; authorizationId?: string; captureId?: string; payer?: Json }
interface Authorization { id: string; orderId: string; status: string; amount: Money; capturedCents: number; created: number; expires: number; invoiceIds: string[] }
interface Capture { id: string; authorizationId: string | null; status: string; amount: Money; finalCapture: boolean; invoiceId?: string; refundedCents: number; created: number }
interface Payout { batchId: string; senderBatchId: string; header: Json; items: { itemId: string; receiver: string; amount: { currency: string; value: string }; note?: string; sender_item_id?: string; status: string }[]; created: number }

export interface Call { method: string; path: string; op: string; status: number; requestId: string | null; requestValid: boolean; responseValid: boolean }
export interface FakeOptions {
  clientId?: string;
  clientSecret?: string;
  /** false: the REST app lacks the Payouts feature (403 on payouts). */
  payouts?: boolean;
  /** Emails that have a sandbox account; payouts to any other email end UNCLAIMED. */
  sandboxEmails?: string[];
  /** false: PayPal reports webhook signatures as invalid. */
  webhookSignaturesValid?: boolean;
  webhookIds?: string[];
  /** false: PayPal ignores PayPal-Request-Id on payouts (exercises the duplicate sender_batch_id recovery). */
  payoutRequestIdHonored?: boolean;
}

export function createFakePayPal(opts: FakeOptions = {}) {
  const o = { clientId: "sandbox-client-id", clientSecret: "sandbox-client-secret", payouts: true, sandboxEmails: [] as string[], webhookSignaturesValid: true, webhookIds: ["8PT597110X687430LKGECATA"], payoutRequestIdHonored: true, ...opts };
  const orders = new Map<string, Order>(), auths = new Map<string, Authorization>(), caps = new Map<string, Capture>(), batches = new Map<string, Payout>();
  const refunds = new Map<string, Json>(), idem = new Map<string, { status: number; body: Json | null }>(), batchBySender = new Map<string, string>(), usedInvoices = new Set<string>();
  const tokens = new Set<string>();
  const calls: Call[] = [], violations: string[] = [];
  const faults: { match: RegExp; when: "before" | "after"; times: number }[] = [];
  let n = 0;
  const newId = (prefix = "") => prefix + (Date.now().toString(36) + (++n).toString(36)).toUpperCase().padStart(17, "0").slice(-17);
  const debugId = () => Math.random().toString(16).slice(2, 15);
  const link = (href: string, rel: string, method = "GET") => ({ href, rel, method });

  const err = (status: number, name: string, message: string, issue?: string, description?: string, field?: string, extra: Json = {}) => ({
    status,
    body: { name, message, debug_id: debugId(), ...(issue ? { details: [{ ...(field ? { field, location: "body" } : {}), issue, description: description ?? message }] } : {}), links: [link(`https://developer.paypal.com/docs/api/${issue ? `#${issue}` : ""}`, "information_link")], ...extra },
  });
  const unprocessable = (issue: string, description: string) => err(422, "UNPROCESSABLE_ENTITY", "The requested action could not be performed, semantically incorrect, or failed business validation.", issue, description);
  const notFound = () => err(404, "RESOURCE_NOT_FOUND", "The specified resource does not exist.", "INVALID_RESOURCE_ID", "Specified resource ID does not exist. Please check the resource ID and try again.");

  const authJson = (a: Authorization) => ({
    id: a.id, status: a.status, amount: a.amount, seller_protection: { status: "ELIGIBLE", dispute_categories: ["ITEM_NOT_RECEIVED", "UNAUTHORIZED_TRANSACTION"] },
    expiration_time: iso(a.expires), create_time: iso(a.created), update_time: iso(Date.now()),
    links: [link(`${SANDBOX}/v2/payments/authorizations/${a.id}`, "self"), link(`${SANDBOX}/v2/payments/authorizations/${a.id}/capture`, "capture", "POST"), link(`${SANDBOX}/v2/payments/authorizations/${a.id}/void`, "void", "POST"), link(`${SANDBOX}/v2/checkout/orders/${a.orderId}`, "up")],
  });
  const capJson = (c: Capture) => {
    const gross = cents(c.amount), fee = Math.round(gross * 0.0349) + 49;
    return {
      id: c.id, status: c.status, amount: c.amount, final_capture: c.finalCapture, ...(c.invoiceId ? { invoice_id: c.invoiceId } : {}),
      seller_protection: { status: "ELIGIBLE", dispute_categories: ["ITEM_NOT_RECEIVED", "UNAUTHORIZED_TRANSACTION"] },
      seller_receivable_breakdown: { gross_amount: c.amount, paypal_fee: { currency_code: c.amount.currency_code, value: dec(fee) }, net_amount: { currency_code: c.amount.currency_code, value: dec(gross - fee) } },
      create_time: iso(c.created), update_time: iso(Date.now()),
      links: [link(`${SANDBOX}/v2/payments/captures/${c.id}`, "self"), link(`${SANDBOX}/v2/payments/captures/${c.id}/refund`, "refund", "POST"), ...(c.authorizationId ? [link(`${SANDBOX}/v2/payments/authorizations/${c.authorizationId}`, "up")] : [])],
    };
  };
  const orderJson = (x: Order) => {
    const pu: Json = { reference_id: x.reference_id, amount: x.amount, payee: { email_address: "merchant@business.example.com", merchant_id: "7KNGBPH2U58GQ" }, ...(x.custom_id ? { custom_id: x.custom_id } : {}), ...(x.description ? { description: x.description } : {}) };
    if (x.authorizationId) pu.payments = { authorizations: [authJson(auths.get(x.authorizationId)!)] };
    if (x.captureId) pu.payments = { captures: [capJson(caps.get(x.captureId)!)] };
    const links = [link(`${SANDBOX}/v2/checkout/orders/${x.id}`, "self")];
    if (x.status === "PAYER_ACTION_REQUIRED") links.push(link(`https://www.sandbox.paypal.com/checkoutnow?token=${x.id}`, "payer-action"));
    return { id: x.id, intent: x.intent, status: x.status, ...(x.payer ? { payment_source: { paypal: x.payer }, payer: { email_address: x.payer.email_address, payer_id: x.payer.account_id, name: x.payer.name } } : {}), purchase_units: [pu], create_time: iso(x.created), links };
  };

  type Out = { status: number; body: Json | null };
  function route(method: string, path: string, body: Json | null, headers: Headers): { spec: SpecName | null; specPath: string; out: Out } {
    let m: RegExpMatchArray | null;
    // ---- Orders v2
    if (method === "POST" && path === "/v2/checkout/orders") {
      const pu = body?.purchase_units?.[0];
      const ctx = body?.payment_source?.paypal?.experience_context;
      const x: Order = { id: newId(), intent: body?.intent, status: ctx ? "PAYER_ACTION_REQUIRED" : "CREATED", amount: pu?.amount, reference_id: pu?.reference_id ?? "default", custom_id: pu?.custom_id, description: pu?.description, returnUrl: ctx?.return_url, cancelUrl: ctx?.cancel_url, created: Date.now() };
      orders.set(x.id, x);
      return { spec: "orders", specPath: "/v2/checkout/orders", out: { status: 201, body: orderJson(x) } };
    }
    if ((m = path.match(/^\/v2\/checkout\/orders\/([^/]+)$/)) && method === "GET") {
      const x = orders.get(m[1]!);
      return { spec: "orders", specPath: "/v2/checkout/orders/{id}", out: x ? { status: 200, body: orderJson(x) } : notFound() };
    }
    if ((m = path.match(/^\/v2\/checkout\/orders\/([^/]+)\/(authorize|capture)$/)) && method === "POST") {
      const verb = m[2]!, specPath = `/v2/checkout/orders/{id}/${verb}`, x = orders.get(m[1]!);
      if (!x) return { spec: "orders", specPath, out: notFound() };
      if ((verb === "authorize") !== (x.intent === "AUTHORIZE")) return { spec: "orders", specPath, out: unprocessable("ACTION_DOES_NOT_MATCH_INTENT", `Order was created with an intent of '${x.intent}'.`) };
      if (x.status === "COMPLETED") return { spec: "orders", specPath, out: unprocessable(verb === "authorize" ? "ORDER_ALREADY_AUTHORIZED" : "ORDER_ALREADY_CAPTURED", "Order already completed.") };
      if (x.status !== "APPROVED") return { spec: "orders", specPath, out: unprocessable("ORDER_NOT_APPROVED", "Payer has not yet approved the Order for payment.") };
      if (verb === "authorize") {
        const a: Authorization = { id: newId(), orderId: x.id, status: "CREATED", amount: x.amount, capturedCents: 0, created: Date.now(), expires: Date.now() + 29 * DAY, invoiceIds: [] };
        auths.set(a.id, a);
        x.authorizationId = a.id;
      } else {
        const c: Capture = { id: newId(), authorizationId: null, status: "COMPLETED", amount: x.amount, finalCapture: true, refundedCents: 0, created: Date.now() };
        caps.set(c.id, c);
        x.captureId = c.id;
      }
      x.status = "COMPLETED";
      return { spec: "orders", specPath, out: { status: 201, body: orderJson(x) } };
    }
    // ---- Payments v2
    if ((m = path.match(/^\/v2\/payments\/authorizations\/([^/]+)\/(capture|reauthorize|void)$/)) && method === "POST") {
      const verb = m[2]!, specPath = `/v2/payments/authorizations/{authorization_id}/${verb}`, a = auths.get(m[1]!);
      if (!a) return { spec: "payments", specPath, out: notFound() };
      const remaining = cents(a.amount) - a.capturedCents;
      if (a.status === "VOIDED") return { spec: "payments", specPath, out: unprocessable("AUTHORIZATION_VOIDED", "A voided authorization cannot be captured, reauthorized or voided.") };
      if (a.status === "CAPTURED") return { spec: "payments", specPath, out: unprocessable("PREVIOUSLY_CAPTURED", "Authorization has been previously captured and hence cannot be captured, reauthorized or voided again.") };
      if (verb === "capture") {
        if (Date.now() > a.expires) return { spec: "payments", specPath, out: unprocessable("AUTHORIZATION_EXPIRED", "An expired authorization cannot be captured.") };
        const amt: Money = body?.amount ?? { currency_code: a.amount.currency_code, value: dec(remaining) };
        if (amt.currency_code !== a.amount.currency_code) return { spec: "payments", specPath, out: unprocessable("CURRENCY_MISMATCH", "Currency of capture must be the same as currency of authorization.") };
        if (cents(amt) > remaining) return { spec: "payments", specPath, out: unprocessable("MAX_CAPTURE_AMOUNT_EXCEEDED", `Capture amount exceeds the ${dec(remaining)} still authorized.`) };
        if (body?.invoice_id && usedInvoices.has(body.invoice_id)) return { spec: "payments", specPath, out: unprocessable("DUPLICATE_INVOICE_ID", "Requested invoice number has been previously captured. Possible duplicate transaction.") };
        if (body?.invoice_id) usedInvoices.add(body.invoice_id);
        const c: Capture = { id: newId(), authorizationId: a.id, status: "COMPLETED", amount: amt, finalCapture: !!body?.final_capture, invoiceId: body?.invoice_id, refundedCents: 0, created: Date.now() };
        caps.set(c.id, c);
        a.capturedCents += cents(amt);
        a.status = c.finalCapture || a.capturedCents >= cents(a.amount) ? "CAPTURED" : "PARTIALLY_CAPTURED";
        return { spec: "payments", specPath, out: { status: 201, body: capJson(c) } };
      }
      if (verb === "reauthorize") {
        if (Date.now() < a.created + 3 * DAY) return { spec: "payments", specPath, out: unprocessable("REAUTHORIZATION_TOO_SOON", "A reauthorization cannot be done within the honor period of 3 days.") };
        const amt: Money = body?.amount ?? { currency_code: a.amount.currency_code, value: dec(remaining) };
        const r: Authorization = { id: newId(), orderId: a.orderId, status: "CREATED", amount: amt, capturedCents: 0, created: Date.now(), expires: a.created + 29 * DAY, invoiceIds: [] };
        auths.set(r.id, r);
        return { spec: "payments", specPath, out: { status: 201, body: authJson(r) } };
      }
      a.status = "VOIDED";
      const wantsBody = /return=representation/.test(headers.get("prefer") ?? "");
      return { spec: "payments", specPath, out: wantsBody ? { status: 200, body: authJson(a) } : { status: 204, body: null } };
    }
    if ((m = path.match(/^\/v2\/payments\/captures\/([^/]+)\/refund$/)) && method === "POST") {
      const specPath = "/v2/payments/captures/{capture_id}/refund", c = caps.get(m[1]!);
      if (!c) return { spec: "payments", specPath, out: notFound() };
      const amt: Money = body?.amount ?? { currency_code: c.amount.currency_code, value: dec(cents(c.amount) - c.refundedCents) };
      if (cents(amt) > cents(c.amount) - c.refundedCents) return { spec: "payments", specPath, out: unprocessable("REFUND_AMOUNT_EXCEEDED", "The refund amount must be less than or equal to the capture amount that has not yet been refunded.") };
      c.refundedCents += cents(amt);
      c.status = c.refundedCents >= cents(c.amount) ? "REFUNDED" : "PARTIALLY_REFUNDED";
      const r = { id: newId(), status: "COMPLETED", amount: amt, ...(body?.invoice_id ? { invoice_id: body.invoice_id } : {}), ...(body?.note_to_payer ? { note_to_payer: body.note_to_payer } : {}), create_time: iso(Date.now()), update_time: iso(Date.now()), links: [link(`${SANDBOX}/v2/payments/refunds/X`, "self"), link(`${SANDBOX}/v2/payments/captures/${c.id}`, "up")] };
      refunds.set(r.id, r);
      return { spec: "payments", specPath, out: { status: 201, body: r } };
    }
    if ((m = path.match(/^\/v2\/payments\/captures\/([^/]+)$/)) && method === "GET") {
      const c = caps.get(m[1]!);
      return { spec: "payments", specPath: "/v2/payments/captures/{capture_id}", out: c ? { status: 200, body: capJson(c) } : notFound() };
    }
    // ---- Payouts v1
    if (path.startsWith("/v1/payments/payouts") && !o.payouts) {
      return { spec: "payouts", specPath: method === "POST" ? "/v1/payments/payouts" : "/v1/payments/payouts/{id}", out: { status: 403, body: { name: "AUTHORIZATION_ERROR", message: "Authorization error occurred.", debug_id: debugId(), information_link: "https://developer.paypal.com/docs/api/payments.payouts-batch/#errors" } } };
    }
    if (method === "POST" && path === "/v1/payments/payouts") {
      const sbid: string = body?.sender_batch_header?.sender_batch_id;
      const existing = sbid ? batchBySender.get(sbid) : undefined;
      if (existing) {
        return { spec: "payouts", specPath: "/v1/payments/payouts", out: { status: 400, body: { name: "USER_BUSINESS_ERROR", message: "User business error.", debug_id: debugId(), information_link: "https://developer.paypal.com/docs/api/payments.payouts-batch/#errors", details: [{ field: "sender_batch_id", location: "body", issue: "Batch with given sender_batch_id already exists" }], links: [{ href: `${SANDBOX}/v1/payments/payouts/${existing}`, rel: "self", method: "GET", encType: "application/json" }] } } };
      }
      const p: Payout = {
        batchId: newId(), senderBatchId: sbid, header: body?.sender_batch_header ?? {}, created: Date.now(),
        items: (body?.items ?? []).map((it: Json) => ({ itemId: newId(), receiver: it.receiver, amount: it.amount, note: it.note, sender_item_id: it.sender_item_id, status: o.sandboxEmails.includes(String(it.receiver).toLowerCase()) ? "SUCCESS" : "UNCLAIMED" })),
      };
      batches.set(p.batchId, p);
      if (sbid) batchBySender.set(sbid, p.batchId);
      return { spec: "payouts", specPath: "/v1/payments/payouts", out: { status: 201, body: { batch_header: { payout_batch_id: p.batchId, batch_status: "PENDING", sender_batch_header: p.header }, links: [{ href: `${SANDBOX}/v1/payments/payouts/${p.batchId}`, rel: "self", method: "GET", encType: "application/json" }] } } };
    }
    if ((m = path.match(/^\/v1\/payments\/payouts\/([^/]+)$/)) && method === "GET") {
      const p = batches.get(m[1]!);
      if (!p) return { spec: "payouts", specPath: "/v1/payments/payouts/{id}", out: { status: 404, body: { name: "INVALID_RESOURCE_ID", message: "Requested resource ID was not found.", debug_id: debugId(), information_link: "https://developer.paypal.com/docs/api/payments.payouts-batch/#errors" } } };
      const total = p.items.reduce((s, it) => s + cents(it.amount), 0), cur = p.items[0]?.amount.currency ?? "USD";
      return {
        spec: "payouts", specPath: "/v1/payments/payouts/{id}",
        out: { status: 200, body: {
          batch_header: { payout_batch_id: p.batchId, batch_status: "SUCCESS", time_created: iso(p.created), time_completed: iso(p.created + 5000), sender_batch_header: p.header, amount: { currency: cur, value: dec(total) }, fees: { currency: cur, value: "0.00" } },
          items: p.items.map((it) => ({ payout_item_id: it.itemId, transaction_id: newId(), transaction_status: it.status, payout_batch_id: p.batchId, payout_item_fee: { currency: it.amount.currency, value: "0.00" }, payout_item: { recipient_type: "EMAIL", amount: it.amount, ...(it.note ? { note: it.note } : {}), receiver: it.receiver, ...(it.sender_item_id ? { sender_item_id: it.sender_item_id } : {}) }, time_processed: iso(p.created + 5000), links: [{ href: `${SANDBOX}/v1/payments/payouts-item/${it.itemId}`, rel: "item", method: "GET", encType: "application/json" }] })),
          links: [{ href: `${SANDBOX}/v1/payments/payouts/${p.batchId}`, rel: "self", method: "GET", encType: "application/json" }],
        } },
      };
    }
    // ---- Webhooks v1
    if (method === "POST" && path === "/v1/notifications/verify-webhook-signature") {
      return { spec: "webhooks", specPath: "/v1/notifications/verify-webhook-signature", out: { status: 200, body: { verification_status: o.webhookSignaturesValid && o.webhookIds.includes(body?.webhook_id) ? "SUCCESS" : "FAILURE" } } };
    }
    if ((m = path.match(/^\/v1\/notifications\/webhooks\/([^/]+)$/)) && method === "GET") {
      const ok = o.webhookIds.includes(m[1]!);
      return { spec: "webhooks", specPath: "/v1/notifications/webhooks/{webhook_id}", out: ok ? { status: 200, body: { id: m[1], url: "https://example.convex.site/paypal/webhook", event_types: [{ name: "CHECKOUT.ORDER.APPROVED" }, { name: "PAYMENT.CAPTURE.COMPLETED" }], links: [link(`${SANDBOX}/v1/notifications/webhooks/${m[1]}`, "self")] } } : { status: 404, body: { name: "INVALID_RESOURCE_ID", message: "Webhook not found.", debug_id: debugId(), details: [{ issue: "INVALID_RESOURCE_ID", description: "Webhook id does not exist." }], links: [] } } };
    }
    return { spec: null, specPath: path, out: err(404, "NOT_FOUND", `No PayPal endpoint ${method} ${path} is modelled.`) };
  }

  async function handle(url: URL, method: string, headers: Headers, raw: string | null): Promise<Response> {
    const path = url.pathname;
    // OAuth 2.0 client credentials (not part of the REST specs above; follows developer.paypal.com/api/rest/authentication)
    if (path === "/v1/oauth2/token") {
      const problems: string[] = [];
      if (method !== "POST") problems.push("token endpoint must be POST");
      if (!/application\/x-www-form-urlencoded/.test(headers.get("content-type") ?? "")) problems.push("token request must be form-encoded");
      if (new URLSearchParams(raw ?? "").get("grant_type") !== "client_credentials") problems.push("grant_type must be client_credentials");
      const basic = (headers.get("authorization") ?? "").match(/^Basic (.+)$/);
      const [id, secret] = basic ? atob(basic[1]!).split(":") : [];
      calls.push({ method, path, op: "oauth2/token", status: 0, requestId: null, requestValid: problems.length === 0, responseValid: true });
      for (const p of problems) violations.push(`POST /v1/oauth2/token: ${p}`);
      if (id !== o.clientId || secret !== o.clientSecret) {
        calls.at(-1)!.status = 401;
        return Response.json({ error: "invalid_client", error_description: "Client Authentication failed" }, { status: 401 });
      }
      const token = `A21AA${newId()}${newId()}`;
      tokens.add(token);
      calls.at(-1)!.status = 200;
      const scope = ["https://uri.paypal.com/services/payments/payment/authcapture", "https://uri.paypal.com/services/payments/refund", "https://uri.paypal.com/services/applications/webhooks", ...(o.payouts ? ["https://uri.paypal.com/services/payments/payouts"] : [])].join(" ");
      return Response.json({ scope, access_token: token, token_type: "Bearer", app_id: "APP-80W284485P519543T", expires_in: 32400, nonce: `${iso(Date.now())}${newId()}` });
    }
    const bearer = (headers.get("authorization") ?? "").match(/^Bearer (.+)$/)?.[1];
    if (!bearer || !tokens.has(bearer)) {
      calls.push({ method, path, op: "auth", status: 401, requestId: null, requestValid: false, responseValid: true });
      return Response.json({ name: "AUTHENTICATION_FAILURE", message: "Authentication failed due to invalid authentication credentials or a missing Authorization header.", debug_id: debugId(), links: [] }, { status: 401 });
    }
    let body: Json | null = null;
    if (raw) {
      if (!/application\/json/.test(headers.get("content-type") ?? "")) violations.push(`${method} ${path}: JSON body sent without Content-Type: application/json`);
      try {
        body = JSON.parse(raw);
      } catch {
        violations.push(`${method} ${path}: body is not valid JSON`);
      }
    }
    const requestId = headers.get("paypal-request-id");
    const idemKey = requestId && method === "POST" ? `${path} ${requestId}` : null;
    const replay = idemKey ? idem.get(idemKey) : undefined;
    const payoutsIgnoreId = path === "/v1/payments/payouts" && !o.payoutRequestIdHonored;
    let routed: { spec: SpecName | null; specPath: string; out: Out };
    if (replay && !payoutsIgnoreId) routed = { spec: specOf(path), specPath: specPathOf(path), out: replay };
    else routed = route(method, path, body, headers);
    const { spec, specPath, out } = routed;
    // validate the request against PayPal's spec
    let requestValid = true;
    if (!spec) {
      requestValid = false;
      violations.push(`${method} ${path}: not an endpoint in PayPal's published specs`);
    } else {
      const op = specs().specs[spec].paths?.[specPath]?.[method.toLowerCase()];
      if (!op) {
        requestValid = false;
        violations.push(`${method} ${specPath}: not an operation in ${SPECS[spec]}`);
      } else if (body) {
        const v = validator(spec, specPath, method.toLowerCase(), "request");
        if (v && !v(body)) {
          requestValid = false;
          violations.push(`${method} ${specPath} request: ${(v.errors ?? []).map((e) => `${e.instancePath || "(body)"} ${e.message}`).join("; ")}`);
        }
      } else if (validator(spec, specPath, method.toLowerCase(), "request") && specs().specs[spec].paths[specPath][method.toLowerCase()].requestBody?.required) {
        requestValid = false;
        violations.push(`${method} ${specPath}: request body is required`);
      }
    }
    // validate our own response too, so the fake can't drift from what PayPal really returns
    let responseValid = true;
    if (spec && out.body) {
      const v = validator(spec, specPath, method.toLowerCase(), "response", out.status);
      if (v && !v(out.body)) {
        responseValid = false;
        violations.push(`FAKE ${method} ${specPath} ${out.status} response: ${(v.errors ?? []).map((e) => `${e.instancePath || "(body)"} ${e.message}`).join("; ")}`);
      }
    }
    if (idemKey && !replay && out.status < 500) idem.set(idemKey, out);
    calls.push({ method, path, op: `${method} ${specPath}`, status: out.status, requestId, requestValid, responseValid });
    const fault = faults.find((f) => f.match.test(`${method} ${path}`) && f.times > 0 && f.when === "after");
    if (fault) {
      fault.times--;
      throw new TypeError("fetch failed (simulated timeout after PayPal processed the request)");
    }
    return out.body === null ? new Response(null, { status: out.status }) : Response.json(out.body, { status: out.status, headers: { "paypal-debug-id": debugId() } });
  }
  function specOf(path: string): SpecName {
    return path.startsWith("/v2/checkout") ? "orders" : path.startsWith("/v2/payments") ? "payments" : path.startsWith("/v1/payments/payouts") ? "payouts" : "webhooks";
  }
  function specPathOf(path: string): string {
    return path
      .replace(/^\/v2\/checkout\/orders\/[^/]+/, "/v2/checkout/orders/{id}")
      .replace(/^\/v2\/payments\/authorizations\/[^/]+/, "/v2/payments/authorizations/{authorization_id}")
      .replace(/^\/v2\/payments\/captures\/[^/]+/, "/v2/payments/captures/{capture_id}")
      .replace(/^\/v1\/payments\/payouts\/[^/]+/, "/v1/payments/payouts/{id}");
  }

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input));
    if (url.origin !== SANDBOX) throw new TypeError(`fake PayPal: unexpected request to ${url.origin} (only ${SANDBOX} is modelled)`);
    const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? req?.headers);
    const raw = init?.body !== undefined && init?.body !== null ? String(init.body) : req ? await req.text() : null;
    const before = faults.find((f) => f.match.test(`${method} ${url.pathname}`) && f.times > 0 && f.when === "before");
    if (before) {
      before.times--;
      throw new TypeError("fetch failed (simulated network error before reaching PayPal)");
    }
    return handle(url, method, headers, raw || null);
  };

  return {
    fetch: fetchImpl,
    calls,
    violations,
    state: { orders, auths, caps, batches, refunds },
    /** The buyer approves the order on PayPal; returns the URL PayPal sends them back to. */
    approve(orderId: string, buyerEmail = "buyer@personal.example.com"): string {
      const x = orders.get(orderId);
      if (!x) throw new Error(`fake PayPal: no order ${orderId}`);
      x.status = "APPROVED";
      x.payer = { email_address: buyerEmail, account_id: "QYR5Z8XDVJNXQ", name: { given_name: "Sandbox", surname: "Buyer" } };
      const back = new URL(x.returnUrl);
      back.searchParams.set("token", x.id);
      back.searchParams.set("PayerID", "QYR5Z8XDVJNXQ");
      return back.toString();
    },
    /** Make the next matching call fail like a dropped connection, before or after PayPal acted on it. */
    failNext(match: RegExp, when: "before" | "after" = "after", times = 1) {
      faults.push({ match, when, times });
    },
    capturedCents: (authorizationId: string) => auths.get(authorizationId)?.capturedCents ?? 0,
    payoutsTo: (email: string) => [...batches.values()].flatMap((b) => b.items.filter((it) => it.receiver === email).map((it) => ({ cents: cents(it.amount), status: it.status }))),
    summary() {
      const byOp = new Map<string, number>();
      for (const c of calls) byOp.set(c.op, (byOp.get(c.op) ?? 0) + 1);
      return [...byOp.entries()].map(([op, count]) => `${count.toString().padStart(3)}  ${op}`).join("\n");
    },
  };
}
export type FakePayPal = ReturnType<typeof createFakePayPal>;

/** For the self-test: which operations have loadable request/response schemas. */
export function schemaCoverage(ops: [SpecName, string, string, number][]) {
  return ops.map(([spec, path, method, status]) => ({
    op: `${method.toUpperCase()} ${path}`,
    operationExists: !!specs().specs[spec].paths?.[path]?.[method],
    request: !!validator(spec, path, method, "request"),
    response: !!validator(spec, path, method, "response", status),
  }));
}
