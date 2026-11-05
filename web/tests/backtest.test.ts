/**
 * Policy backtest: replaying real purchase history under edited limits.
 */
import { officeSuppliesMandate, type MandatePolicy } from "@kept/core";
import { describe, expect, it } from "vitest";
import { backtest, type PastSpend } from "@/lib/backtest";

const policy: MandatePolicy = { ...officeSuppliesMandate, version: 1, budgetCents: 20000, perPurchaseMaxCents: 5000, approvalAboveCents: 3000, maxPerHour: 5, allowedMerchants: ["@supplies.example.com"] };
const t0 = 1_700_000_000_000;
const spend = (i: number, amountCents: number, status: string, merchantEmail = "orders@supplies.example.com"): PastSpend => ({ id: `s${i}`, createdAt: t0 + i * 600_000, status, merchantName: "Supplies", merchantEmail, amountCents, description: "paper" });

describe("backtest", () => {
  const history = [spend(1, 1200, "paid"), spend(2, 4500, "paid"), spend(3, 9000, "denied"), spend(4, 2500, "paid", "pay@other.example.com")];

  it("reproduces what happened under the real rules (merchant check included)", () => {
    const r = backtest({ ...policy, allowedMerchants: [...policy.allowedMerchants, "@other.example.com"] }, t0, 250, history);
    expect(r.map((x) => x.decision)).toEqual(["approve", "needs_approval", "deny", "approve"]);
  });

  it("a stricter cap blocks purchases that went through", () => {
    const r = backtest({ ...policy, perPurchaseMaxCents: 2000 }, t0, 250, history);
    expect(r[1]).toMatchObject({ decision: "deny", actual: "approve", changed: true });
  });

  it("an off-list merchant is blocked", () => {
    const r = backtest(policy, t0, 250, history);
    expect(r[3]).toMatchObject({ decision: "deny", changed: true });
    expect(r[3].reasons.join(" ")).toMatch(/allowlist/);
  });

  it("the budget accumulates only what the edited rules let through", () => {
    const r = backtest({ ...policy, budgetCents: 5000, approvalAboveCents: null }, t0, 250, [spend(1, 3000, "paid"), spend(2, 3000, "paid")]);
    expect(r.map((x) => x.decision)).toEqual(["approve", "deny"]);
  });
});
