/**
 * Kept's real PayPal code path (rails/paypal.ts), end to end, against a stand-in for the PayPal
 * sandbox that validates every request and response against PayPal's published OpenAPI specs
 * and enforces PayPal's money rules (see fake-paypal.ts). These are the same lifecycles the sim-rail
 * tests run, so a judge who sets their own sandbox keys gets the flow these tests prove.
 *
 *   npm run test:paypal
 */
import { generateSigningKey, logoFixed, officeSuppliesMandate } from "@kept/core";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { hashSecret } from "../../convex/lib/secrets";
import { createFakePayPal, schemaCoverage, type FakePayPal } from "./fake-paypal";

const modules = import.meta.glob("../../convex/**/*.*s");
const key = generateSigningKey();
const SITE = "http://localhost:3000";
const PAYEE_PAYPAL = "designer-sandbox@personal.example.com";
let pp: FakePayPal;

function useFake(opts: Parameters<typeof createFakePayPal>[0] = {}) {
  pp = createFakePayPal({ sandboxEmails: [PAYEE_PAYPAL], ...opts });
  vi.stubGlobal("fetch", pp.fetch);
  return pp;
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(process.env, {
    PAYMENT_RAIL: "paypal",
    PAYPAL_CLIENT_ID: "sandbox-client-id",
    PAYPAL_CLIENT_SECRET: "sandbox-client-secret",
    SITE_URL: SITE,
    RECEIPT_SIGNING_KEY: key.secretKeyHex,
    FEE_BPS: "250",
  });
  delete process.env.PAYPAL_ENV;
  delete process.env.PAYPAL_WEBHOOK_ID;
  delete process.env.ANTHROPIC_API_KEY;
  useFake();
});
afterEach(() => {
  // Every request Kept sent, and every answer the fake gave, matched PayPal's published specs.
  expect(pp.violations, `PayPal contract violations:\n${pp.violations.join("\n")}\n\nCalls:\n${pp.summary()}`).toEqual([]);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function drain(t: ReturnType<typeof convexTest>, rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    vi.advanceTimersByTime(1_000);
    await t.finishInProgressScheduledFunctions();
  }
}
async function user(t: ReturnType<typeof convexTest>, email: string, payoutEmail?: string): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email });
    await ctx.db.insert("profiles", { userId, email, displayName: email.split("@")[0], role: "user", createdAt: Date.now(), ...(payoutEmail ? { payoutEmail } : {}) });
    return userId;
  });
}
const orderIdOf = (approveUrl: string) => new URL(approveUrl).searchParams.get("token")!;

/** Proved, approved by both sides, funding started on PayPal (buyer not yet approved). */
async function fundingContract(t: ReturnType<typeof convexTest>) {
  const funder = await user(t, "client@example.com");
  const payee = await user(t, "designer@example.com", PAYEE_PAYPAL);
  const created = await t.action(internal.contracts.createAs, { userId: funder, prompt: "logo", role: "funder", counterpartyEmail: "designer@example.com", ir: logoFixed });
  await t.mutation(internal.contracts.acceptInviteAs, { userId: payee, token: created.inviteToken });
  await drain(t);
  const view = await t.query(internal.contracts.getAs, { userId: funder, contractId: created.contractId });
  for (const userId of [funder, payee]) await t.mutation(internal.contracts.approveAs, { userId, contractId: created.contractId, termsHash: view.termsHash! });
  const order = await t.action(internal.funding.startAs, { userId: funder, contractId: created.contractId });
  return { funder, payee, contractId: created.contractId, order };
}
async function liveContract(t: ReturnType<typeof convexTest>) {
  const c = await fundingContract(t);
  const back = pp.approve(orderIdOf(c.order.approveUrl));
  expect(back.startsWith(`${SITE}/contracts/${c.contractId}?funding=approved`)).toBe(true); // PayPal sends the buyer back to the web app
  await t.action(internal.funding.confirmAs, { userId: c.funder, contractId: c.contractId });
  return c;
}

describe("PayPal's published specs are loaded", () => {
  it("has request and response schemas for every endpoint Kept calls", () => {
    const cov = schemaCoverage([
      ["orders", "/v2/checkout/orders", "post", 201],
      ["orders", "/v2/checkout/orders/{id}", "get", 200],
      ["orders", "/v2/checkout/orders/{id}/authorize", "post", 201],
      ["orders", "/v2/checkout/orders/{id}/capture", "post", 201],
      ["payments", "/v2/payments/authorizations/{authorization_id}/capture", "post", 201],
      ["payments", "/v2/payments/authorizations/{authorization_id}/reauthorize", "post", 201],
      ["payments", "/v2/payments/authorizations/{authorization_id}/void", "post", 200],
      ["payments", "/v2/payments/captures/{capture_id}/refund", "post", 201],
      ["payments", "/v2/payments/captures/{capture_id}", "get", 200],
      ["payouts", "/v1/payments/payouts", "post", 201],
      ["payouts", "/v1/payments/payouts/{id}", "get", 200],
      ["webhooks", "/v1/notifications/verify-webhook-signature", "post", 200],
    ]);
    for (const c of cov) {
      expect(c.operationExists, c.op).toBe(true);
      expect(c.response, `${c.op} response schema`).toBe(true);
    }
    // operations that take a JSON body
    expect(cov.filter((c) => c.request).map((c) => c.op)).toEqual(expect.arrayContaining(["POST /v2/checkout/orders", "POST /v2/payments/authorizations/{authorization_id}/capture", "POST /v2/payments/captures/{capture_id}/refund", "POST /v1/payments/payouts", "POST /v1/notifications/verify-webhook-signature"]));
  });
});

describe("contract lifecycle on the PayPal rail", () => {
  it("asks the buyer to approve on PayPal, then authorizes, captures in two parts and pays out", async () => {
    const t = convexTest(schema, modules);
    const { funder, payee, contractId, order } = await fundingContract(t);
    expect(order.approveUrl).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\/checkoutnow\?token=/);

    // Confirming before the buyer approved is refused with a clear message, not a crash.
    await expect(t.action(internal.funding.confirmAs, { userId: funder, contractId })).rejects.toThrow(/Approve the payment on PayPal first/);

    pp.approve(orderIdOf(order.approveUrl));
    await t.action(internal.funding.confirmAs, { userId: funder, contractId });
    await drain(t);
    let c = await t.run((ctx) => ctx.db.get(contractId));
    expect(c!.status).toBe("active");
    const authorizationId = c!.funding!.authorizationId!;
    expect(pp.state.auths.get(authorizationId)!.amount).toEqual({ currency_code: "USD", value: "307.50" }); // $300 + up to $7.50 fee
    expect(pp.capturedCents(authorizationId)).toBe(10_250); // $100 upfront + 2.5% fee

    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><text>Acme</text></svg>'], { type: "image/svg+xml" })));
    const sub = await t.mutation(internal.evidence.submitAs, { userId: payee, contractId, slotId: "final_svg", storageId, fileName: "logo.svg" });
    await t.mutation(internal.evidence.acceptAs, { userId: funder, evidenceId: sub.evidenceId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    c = await t.run((ctx) => ctx.db.get(contractId));
    expect(c!.status).toBe("settled");
    expect(c!.ledger).toMatchObject({ releasedCents: 30_000, refundedCents: 0, feesCents: 750, capturedCents: 30_750, paidOutCents: 30_000, heldCents: 0 });
    // What PayPal itself recorded agrees with Kept's ledger.
    // What PayPal itself recorded agrees with Kept's ledger. The second release came a week later, after
    // PayPal's 3-day honor period, so Kept renewed the hold first (reauthorize, allowed on days 4-29).
    const holds = [...pp.state.auths.values()].filter((a) => a.orderId === pp.state.auths.get(authorizationId)!.orderId);
    expect(holds.reduce((sum, a) => sum + a.capturedCents, 0)).toBe(30_750);
    const reauth = holds.find((a) => a.id !== authorizationId);
    if (reauth) {
      expect(reauth.created - pp.state.auths.get(authorizationId)!.created).toBeGreaterThan(3 * 86_400_000);
      expect(reauth.amount.value).toBe("205.00"); // exactly what was still held
    }
    expect(pp.payoutsTo(PAYEE_PAYPAL)).toEqual([{ cents: 10_000, status: "SUCCESS" }, { cents: 20_000, status: "SUCCESS" }]);
  });

  it("refunds by voiding the uncaptured hold when nothing is delivered", async () => {
    const t = convexTest(schema, modules);
    const { contractId } = await liveContract(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers); // the 7-day deadline fires
    const c = await t.run((ctx) => ctx.db.get(contractId));
    expect(c!.status).toBe("settled");
    expect(c!.ledger).toMatchObject({ releasedCents: 10_000, refundedCents: 20_000, capturedCents: 10_250, paidOutCents: 10_000, voidedCents: 20_500 });
    const a = pp.state.auths.get(c!.funding!.authorizationId!)!;
    expect(a.status).toBe("VOIDED");
    expect(a.capturedCents).toBe(10_250); // the buyer is only ever charged what was released
  });

  it("never moves money twice when PayPal answers after the connection drops", async () => {
    const t = convexTest(schema, modules);
    // The first capture and the first payout both succeed at PayPal, but Kept never hears back.
    pp.failNext(/POST \/v2\/payments\/authorizations\/[^/]+\/capture/, "after");
    pp.failNext(/POST \/v1\/payments\/payouts$/, "after");
    const { contractId } = await liveContract(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const c = await t.run((ctx) => ctx.db.get(contractId));
    expect(pp.capturedCents(c!.funding!.authorizationId!)).toBe(10_250); // not 20_500
    expect(pp.payoutsTo(PAYEE_PAYPAL)).toEqual([{ cents: 10_000, status: "SUCCESS" }]); // one payout, not two
    expect(c!.ledger).toMatchObject({ capturedCents: 10_250, paidOutCents: 10_000 });
    // The retries reused the same PayPal-Request-Id, which is what made PayPal replay its answer.
    const caps = pp.calls.filter((x) => x.op === "POST /v2/payments/authorizations/{authorization_id}/capture");
    expect(caps.length).toBe(2);
    expect(caps[0]!.requestId).toBe(caps[1]!.requestId);
  });

  it("recovers a payout PayPal already made even when the retry is rejected as a duplicate batch", async () => {
    const t = convexTest(schema, modules);
    useFake({ payoutRequestIdHonored: false }); // PayPal answers the retry with "sender_batch_id already exists"
    pp.failNext(/POST \/v1\/payments\/payouts$/, "after");
    const { contractId } = await liveContract(t);
    await drain(t);
    const c = await t.run((ctx) => ctx.db.get(contractId));
    expect(c!.ledger.paidOutCents).toBe(10_000);
    expect(pp.payoutsTo(PAYEE_PAYPAL)).toEqual([{ cents: 10_000, status: "SUCCESS" }]);
    expect(pp.calls.some((x) => x.op === "POST /v1/payments/payouts" && x.status === 400)).toBe(true);
  });

  it("still completes when the payee's email has no PayPal account (payout UNCLAIMED, as in the sandbox)", async () => {
    const t = convexTest(schema, modules);
    useFake({ sandboxEmails: [] });
    const { contractId } = await liveContract(t);
    await drain(t);
    const c = await t.run((ctx) => ctx.db.get(contractId));
    expect(c!.ledger.paidOutCents).toBe(10_000);
    expect(pp.payoutsTo(PAYEE_PAYPAL)).toEqual([{ cents: 10_000, status: "UNCLAIMED" }]);
  });

  it("confirms funding from PayPal's CHECKOUT.ORDER.APPROVED webhook when the buyer closes the tab", async () => {
    process.env.PAYPAL_WEBHOOK_ID = "8PT597110X687430LKGECATA";
    const t = convexTest(schema, modules);
    const { contractId, order } = await fundingContract(t);
    const orderId = orderIdOf(order.approveUrl);
    pp.approve(orderId);
    const headers = { "content-type": "application/json", "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77", "paypal-transmission-id": "69cd13f0-d67a-11e5-baa3-778b53f4ae55", "paypal-transmission-sig": "lmI95Jx3Y9nhR5SJWlHVIWpg4AgFk7n9bCHSRxbrd8A9zrhdu2rMyFrmz+Zjh3s3boXB07VXCXUZy/UFzUlnGJn0wDugt7FlSvdKeIJenLRemUxYCPVoEZzg9VFNqOa48gMkvF+XTpxBeUx/kWy6B5cp7GkT2+pOowfRK7OaynuxUoKW3JcMWw272VKjLTtTAShncla7tGF+55rxyt2KNZIIqxNMJ48RDZheGU5w1npu9dZHnPgTXB9iomeVRoD8O/jhRpnKsGrDschyNdkeh81BJJMH4Ctc6lnCCquoP/GzCzz33MMsNdid7vL/NIWaCsekQpW26FpWPi/tfj8nLA==", "paypal-transmission-time": "2016-02-18T20:01:35Z" };
    const res = await t.fetch("/paypal/webhook", { method: "POST", headers, body: JSON.stringify({ id: "WH-EVENT-1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: orderId, status: "APPROVED" } }) });
    expect(res.status).toBeLessThan(300);
    await drain(t);
    const c = await t.run((ctx) => ctx.db.get(contractId));
    expect(c!.status).toBe("active");
  });

  it("drops webhooks whose signature PayPal does not confirm", async () => {
    process.env.PAYPAL_WEBHOOK_ID = "8PT597110X687430LKGECATA";
    useFake({ webhookSignaturesValid: false });
    const t = convexTest(schema, modules);
    const res = await t.fetch("/paypal/webhook", { method: "POST", headers: { "content-type": "application/json", "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1", "paypal-transmission-id": "t-1", "paypal-transmission-sig": "c2ln", "paypal-transmission-time": "2026-11-11T10:00:00Z" }, body: JSON.stringify({ id: "WH-EVENT-2", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "NOPE" } }) });
    expect(res.status).toBe(400);
  });
});

describe("agent budget on the PayPal rail", () => {
  it("funds with an authorization, pays merchants by capture + payout, and voids the rest on close", async () => {
    const t = convexTest(schema, modules);
    useFake({ sandboxEmails: ["desk@supplies.example.com"] });
    const owner = await user(t, "owner@example.com");
    const { mandateId } = await t.mutation(internal.mandates.createAs, { userId: owner, policy: officeSuppliesMandate });
    const order = await t.action(internal.mandates.fundStartAs, { userId: owner, mandateId });
    expect(order.approveUrl).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\/checkoutnow\?token=/);
    expect(pp.approve(orderIdOf(order.approveUrl)).startsWith(`${SITE}/mandates/${mandateId}?funding=approved`)).toBe(true);
    await t.action(internal.mandates.fundConfirmAs, { userId: owner, mandateId });
    const { token } = await t.action(internal.mandates.issueTokenAs, { userId: owner, mandateId, label: "buyer bot" });
    const tokenHash = hashSecret(token);
    const spend = (amountCents: number, k: string, merchantEmail = "desk@supplies.example.com") =>
      t.mutation(internal.agentApi.requestSpend, { tokenHash, merchantEmail, merchantName: "Supplies", amountCents, currency: "USD", description: "printer paper", idempotencyKey: k });
    expect((await spend(2_500, "k1")).status).toBe("executing");
    const b = await spend(4_000, "k2");
    expect(b.status).toBe("needs_approval");
    expect((await spend(6_000, "k3")).status).toBe("denied");
    await t.mutation(internal.mandates.decideSpendAs, { userId: owner, spendId: b.spendId, approve: true });
    await drain(t);
    await t.mutation(internal.mandates.revokeAs, { userId: owner, mandateId });
    await drain(t);

    const m = await t.run((ctx) => ctx.db.get(mandateId));
    expect(m!.status).toBe("closed");
    const a = pp.state.auths.get(m!.funding!.authorizationId!)!;
    expect(a.status).toBe("VOIDED");
    expect(a.capturedCents).toBe(m!.ledger.capturedCents);
    expect(pp.payoutsTo("desk@supplies.example.com").map((x) => x.cents).sort()).toEqual([2_500, 4_000]);
  });
});

describe("npm run paypal:check", () => {
  const run = async () => (await import("../../convex/paypalCheck")).checkPaypalSetup();

  it("passes on a correctly set-up sandbox app", async () => {
    const r = await run();
    expect(r.lines.filter((l) => l.startsWith("✗"))).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toMatch(/PayPal accepted your sandbox credentials[\s\S]*Orders work[\s\S]*Payouts is enabled/);
  });

  it("explains a wrong secret", async () => {
    process.env.PAYPAL_CLIENT_SECRET = "pasted-the-live-secret";
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toMatch(/✗ PayPal rejected the client ID and secret .*Sandbox tab/);
  });

  it("explains how to enable Payouts when the app lacks it", async () => {
    useFake({ payouts: false });
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toMatch(/✗ Payouts is not enabled .*Features → tick Payouts/);
  });

  it("explains missing keys without calling PayPal", async () => {
    delete process.env.PAYPAL_CLIENT_ID;
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toMatch(/✗ PAYPAL_CLIENT_ID is not set/);
    expect(pp.calls).toEqual([]);
  });
});
