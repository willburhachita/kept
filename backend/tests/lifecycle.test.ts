/**
 * End-to-end lifecycles on the deterministic sim rail: contract happy path,
 * deadline refund, agent mandate spending, and journal integrity.
 */
import { generateSigningKey, logoFixed, officeSuppliesMandate, verifyChain, type SignedJournalEntry } from "@kept/core";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { hashSecret } from "../convex/lib/secrets";

const modules = import.meta.glob("../convex/**/*.*s");
const key = generateSigningKey();

beforeEach(() => {
  vi.useFakeTimers();
  process.env.PAYMENT_RAIL = "sim";
  process.env.RECEIPT_SIGNING_KEY = key.secretKeyHex;
  process.env.FEE_BPS = "250";
  delete process.env.ANTHROPIC_API_KEY;
});
afterEach(() => vi.useRealTimers());

/** Run whatever is scheduled in the next few seconds (not long timers like deadlines or expiry). */
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

async function liveContract(t: ReturnType<typeof convexTest>) {
  const funder = await user(t, "client@example.com");
  const payee = await user(t, "designer@example.com", "designer-paypal@example.com");
  const created = await t.action(internal.contracts.createAs, { userId: funder, prompt: "logo", role: "funder", counterpartyEmail: "designer@example.com", ir: logoFixed });
  await t.mutation(internal.contracts.acceptInviteAs, { userId: payee, token: created.inviteToken });
  await drain(t); // verification
  let view = await t.query(internal.contracts.getAs, { userId: funder, contractId: created.contractId });
  expect(view.status).toBe("review");
  expect(view.verification?.ok).toBe(true);
  for (const userId of [funder, payee]) await t.mutation(internal.contracts.approveAs, { userId, contractId: created.contractId, termsHash: view.termsHash! });
  const order = await t.action(internal.funding.startAs, { userId: funder, contractId: created.contractId });
  expect(order.approveUrl).toContain("/sim/approve");
  await t.action(internal.funding.confirmAs, { userId: funder, contractId: created.contractId });
  view = await t.query(internal.contracts.getAs, { userId: funder, contractId: created.contractId });
  expect(view.frozen?.reason ?? null).toBeNull();
  expect(view.status).toBe("active");
  return { funder, payee, contractId: created.contractId };
}

describe("contract lifecycle (sim rail)", () => {
  it("delivers, accepts, captures in two parts and pays out everything", async () => {
    const t = convexTest(schema, modules);
    const { funder, payee, contractId } = await liveContract(t);
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><text>Acme</text></svg>'], { type: "image/svg+xml" })));
    const sub = await t.mutation(internal.evidence.submitAs, { userId: payee, contractId, slotId: "final_svg", storageId, fileName: "logo.svg" });
    expect(sub.status).toBe("awaiting_funder"); // no AI key in tests
    await t.mutation(internal.evidence.acceptAs, { userId: funder, evidenceId: sub.evidenceId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const c = await t.run((ctx) => ctx.db.get(contractId));
    expect(c!.status).toBe("settled");
    expect(c!.ledger).toMatchObject({ releasedCents: 30_000, refundedCents: 0, feesCents: 750, capturedCents: 30_750, paidOutCents: 30_000, heldCents: 0 });
    expect(c!.funding!.captures.map((x) => x.cents)).toEqual([10_250, 20_500]);
    expect(c!.funding!.voided).toBeUndefined(); // fully captured, nothing to void
  });

  it("refunds the remainder and voids the hold when nothing is delivered", async () => {
    const t = convexTest(schema, modules);
    const { contractId } = await liveContract(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers); // the 7-day deadline fires
    const c = await t.run((ctx) => ctx.db.get(contractId));
    expect(c!.status).toBe("settled");
    expect(c!.machine!.passed).toEqual(["delivery"]);
    expect(c!.ledger).toMatchObject({ releasedCents: 10_000, refundedCents: 20_000, feesCents: 250, capturedCents: 10_250, paidOutCents: 10_000, voidedCents: 20_500 });
  });

  it("keeps a valid signed hash chain", async () => {
    const t = convexTest(schema, modules);
    const { contractId } = await liveContract(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const entries = await t.run((ctx) => ctx.db.query("journal").withIndex("by_stream_seq", (q) => q.eq("stream", contractId)).collect());
    expect(entries.length).toBeGreaterThan(8);
    const check = verifyChain(entries as unknown as SignedJournalEntry[], { [key.keyId]: key.publicKeyHex });
    expect(check).toEqual({ ok: true, checked: entries.length });
  });

  it("rejects approval of stale terms and blocks non-participants", async () => {
    const t = convexTest(schema, modules);
    const funder = await user(t, "a@example.com");
    const stranger = await user(t, "b@example.com");
    const created = await t.action(internal.contracts.createAs, { userId: funder, prompt: "x", role: "funder", ir: logoFixed });
    await expect(t.query(internal.contracts.getAs, { userId: stranger, contractId: created.contractId })).rejects.toThrow(/not found/i);
    await expect(t.mutation(internal.contracts.approveAs, { userId: funder, contractId: created.contractId, termsHash: "0".repeat(64) })).rejects.toThrow();
  });
});

describe("agent mandate (sim rail)", () => {
  it("approves, escalates, denies and closes", async () => {
    const t = convexTest(schema, modules);
    const owner = await user(t, "owner@example.com");
    const { mandateId } = await t.mutation(internal.mandates.createAs, { userId: owner, policy: officeSuppliesMandate });
    await t.action(internal.mandates.fundStartAs, { userId: owner, mandateId });
    await t.action(internal.mandates.fundConfirmAs, { userId: owner, mandateId });
    const { token } = await t.action(internal.mandates.issueTokenAs, { userId: owner, mandateId, label: "buyer bot" });
    const tokenHash = hashSecret(token);
    const spend = (amountCents: number, key: string, merchantEmail = "desk@supplies.example.com") =>
      t.mutation(internal.agentApi.requestSpend, { tokenHash, merchantEmail, merchantName: "Supplies", amountCents, currency: "USD", description: "printer paper", idempotencyKey: key });

    const a = await spend(2_500, "k1");
    expect(a.status).toBe("executing");
    expect(await spend(2_500, "k1")).toMatchObject({ spendId: a.spendId }); // idempotent
    const b = await spend(4_000, "k2");
    expect(b.status).toBe("needs_approval");
    expect((await spend(6_000, "k3")).status).toBe("denied");
    expect((await spend(1_000, "k4", "x@evil.example")).status).toBe("denied");
    await t.mutation(internal.mandates.decideSpendAs, { userId: owner, spendId: b.spendId, approve: true });
    await drain(t);

    const view = await t.query(internal.mandates.getAs, { userId: owner, mandateId });
    expect(view.spentCents).toBe(6_500);
    expect(view.remainingCents).toBe(13_500);
    const spends = await t.query(internal.mandates.spendsAs, { userId: owner, mandateId });
    expect(spends.filter((s) => s.status === "paid").map((s) => s.amountCents).sort()).toEqual([2_500, 4_000]);

    await t.mutation(internal.mandates.revokeAs, { userId: owner, mandateId });
    await drain(t);
    const m = await t.run((ctx) => ctx.db.get(mandateId));
    expect(m!.status).toBe("closed");
    expect(m!.ledger.voidedCents).toBe(m!.funding!.authorizationCents - m!.ledger.capturedCents);
    const late = await spend(100, "k5");
    expect(late.status).toBe("denied");
    expect(late.reasons.join(" ")).toMatch(/closed|not active/);
  });
});
