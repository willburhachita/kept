/**
 * PayPal setup check: run it right after setting your sandbox keys.
 *
 *   npm run paypal:check          (from the repo root; same as `npx convex run paypalCheck:run` in backend/)
 *
 * It uses the deployment's own environment, exactly as Kept will, and makes only harmless calls:
 * an OAuth token, one $1.00 order that is never approved (PayPal discards it), a lookup of a payout
 * batch that doesn't exist (to see whether Payouts is enabled), and a webhook lookup if one is set.
 * Every line says what passed, or what failed and how to fix it.
 */
import { internalAction } from "./_generated/server";
import { env } from "./lib/env";

type Line = { ok: "pass" | "fail" | "warn" | "info"; text: string };
const mark = { pass: "✓", fail: "✗", warn: "!", info: "·" } as const;

async function hit(url: string, init: RequestInit): Promise<{ status: number; json: Record<string, any> | null } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json: Record<string, any> | null = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
const why = (j: Record<string, any> | null) => j?.details?.[0]?.issue ?? j?.name ?? j?.error ?? "";

export async function checkPaypalSetup(): Promise<{ ok: boolean; lines: string[] }> {
  const out: Line[] = [];
  const add = (ok: Line["ok"], text: string) => out.push({ ok, text });
  const done = () => ({ ok: !out.some((l) => l.ok === "fail"), lines: [...out.map((l) => `${mark[l.ok]} ${l.text}`), "", out.some((l) => l.ok === "fail") ? "Not ready yet: fix the ✗ lines above, then run this again." : "Ready: Kept will use your PayPal sandbox."] });

  // 1. configuration
  const rail = env.rail();
  if (rail === "sim") add("warn", "PAYMENT_RAIL is \"sim\": Kept is using its built-in PayPal simulator. Fix: npx convex env set PAYMENT_RAIL paypal");
  else add("pass", "PAYMENT_RAIL is \"paypal\"");
  const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) {
    add("fail", `${!id ? "PAYPAL_CLIENT_ID" : "PAYPAL_CLIENT_SECRET"} is not set. Fix: developer.paypal.com → Apps & Credentials → Sandbox → your app, then npx convex env set PAYPAL_CLIENT_ID <id> and npx convex env set PAYPAL_CLIENT_SECRET <secret>`);
    return done();
  }
  const cfg = env.paypal();
  add(cfg.live ? "warn" : "pass", cfg.live ? "PAYPAL_ENV is \"live\": real money. For the hackathon, remove it (npx convex env remove PAYPAL_ENV) to use the sandbox." : `Using the PayPal sandbox (${cfg.baseUrl})`);

  // 2. credentials
  const tok = await hit(`${cfg.baseUrl}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  if ("error" in tok) {
    add("fail", `Can't reach PayPal (${tok.error}). Check the deployment's internet access, then run this again.`);
    return done();
  }
  if (tok.status !== 200 || !tok.json?.access_token) {
    add("fail", `PayPal rejected the client ID and secret (HTTP ${tok.status} ${why(tok.json)}). Fix: copy both again from Apps & Credentials with the Sandbox tab selected (live keys don't work against the sandbox).`);
    return done();
  }
  add("pass", `PayPal accepted your sandbox credentials (app ${tok.json.app_id ?? "?"})`);
  const scope: string = tok.json.scope ?? "";
  const auth = { Authorization: `Bearer ${tok.json.access_token}`, "Content-Type": "application/json" };

  // 3. Orders: create (but never approve) a $1.00 authorization order, exactly like Kept does
  const site = env.siteUrl();
  const order = await hit(`${cfg.baseUrl}/v2/checkout/orders`, {
    method: "POST",
    headers: { ...auth, Prefer: "return=representation", "PayPal-Request-Id": `kept-check-${Date.now()}` },
    body: JSON.stringify({
      intent: "AUTHORIZE",
      purchase_units: [{ reference_id: "kept-setup-check", description: "Kept setup check (never approved, no money moves)", amount: { currency_code: "USD", value: "1.00" } }],
      payment_source: { paypal: { experience_context: { brand_name: env.brandName(), user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", return_url: `${site}/dashboard`, cancel_url: `${site}/dashboard` } } },
    }),
  });
  if ("error" in order || (order.status !== 200 && order.status !== 201)) {
    const detail = "error" in order ? order.error : `HTTP ${order.status} ${why(order.json)}: ${order.json?.details?.[0]?.description ?? order.json?.message ?? ""}`;
    add("fail", `PayPal refused a test order (${detail}). Fix: make sure the sandbox app has "Accept payments" enabled and that SITE_URL (${site}) is a full http(s) URL.`);
  } else {
    const approve = (order.json?.links ?? []).find((l: { rel: string }) => l.rel === "payer-action" || l.rel === "approve");
    add(approve ? "pass" : "fail", approve ? "Orders work: PayPal returned a buyer approval link (the test order is never approved; no money moves)" : "PayPal created the order but returned no approval link. Please report this with the order id " + order.json?.id);
  }

  // 4. Payouts: look up a batch that doesn't exist. 404 = allowed to use Payouts; 403 = Payouts not enabled.
  const po = await hit(`${cfg.baseUrl}/v1/payments/payouts/KEPTSETUPCHECK0000`, { method: "GET", headers: auth });
  if (!("error" in po) && po.status === 404) add("pass", "Payouts is enabled on your app (Kept pays sellers and payees with it)");
  else if (!("error" in po) && (po.status === 403 || po.status === 401)) add("fail", "Payouts is not enabled on your sandbox app, so payees can't be paid. Fix: developer.paypal.com → Apps & Credentials → Sandbox → your app → Features → tick Payouts → Save. Then run this again.");
  else add(scope.includes("payouts") ? "pass" : "warn", scope.includes("payouts") ? "Payouts permission present in your app's scopes" : `Couldn't confirm Payouts (${"error" in po ? po.error : `HTTP ${po.status}`}). If payouts fail later, enable Payouts on the app.`);

  // 5. Webhooks (optional)
  const wh = process.env.PAYPAL_WEBHOOK_ID;
  const expected = `${env.convexSiteUrl()}/paypal/webhook`;
  if (!wh) add("info", `PAYPAL_WEBHOOK_ID not set (optional). Kept confirms payments when the buyer comes back from PayPal; a webhook also covers buyers who close the tab. To add one: Apps & Credentials → your app → Add Webhook → URL ${expected}`);
  else {
    const w = await hit(`${cfg.baseUrl}/v1/notifications/webhooks/${encodeURIComponent(wh)}`, { method: "GET", headers: auth });
    if (!("error" in w) && w.status === 200) {
      const url: string = w.json?.url ?? "";
      add(url === expected || !env.convexSiteUrl() ? "pass" : "warn", url === expected || !env.convexSiteUrl() ? `Webhook ${wh} found (${url})` : `Webhook ${wh} points to ${url}, but this deployment receives webhooks at ${expected}. Fix the URL in the PayPal dashboard.`);
    } else add("fail", `PAYPAL_WEBHOOK_ID ${wh} wasn't found on this app (${"error" in w ? w.error : `HTTP ${w.status}`}). Fix: copy the Webhook ID from the same sandbox app, or unset it.`);
  }

  // 6. where PayPal sends buyers back
  if (/^https?:\/\/[^/]+/.test(site)) add("pass", `After approving, PayPal sends buyers back to ${site} (run the web app there: npm run dev:web)`);
  else add("fail", `SITE_URL "${site}" isn't a full URL. Fix: npx convex env set SITE_URL http://localhost:3000`);

  // 7. AI (required for the full product, not for payments)
  add(env.anthropicKey() ? "pass" : "warn", env.anthropicKey() ? "ANTHROPIC_API_KEY is set (Claude writes and checks deals)" : "ANTHROPIC_API_KEY is not set: Claude features are off (proved templates and manual review still work). Fix: npx convex env set ANTHROPIC_API_KEY <key>");
  return done();
}

export const run = internalAction({
  args: {},
  handler: async (): Promise<string[]> => (await checkPaypalSetup()).lines,
});
