import { describe, expect, it } from "vitest";
import {
  EventRejected,
  initialState,
  irHash,
  logoFixed,
  logoNaive,
  plumberDraft,
  plumberVisit,
  renderContract,
  step,
  validateContract,
  verify,
  verifyContract,
  violationsForRepair,
  type ContractIR,
} from "../src/index.js";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe("verifier", () => {
  it("proves the repaired logo contract", () => {
    const r = verify(logoFixed, { feeBps: 250 });
    expect(r.ok).toBe(true);
    expect(r.properties.every((p) => p.status === "proved")).toBe(true);
    expect(r.stats.states).toBeGreaterThan(5);
    expect(r.stats.truncated).toBe(false);
    expect(r.lifecycle.authorizationCents).toBe(30_000 + 750);
    expect(r.warnings).toEqual([]);
  });

  it("computes every outcome and the money/time bounds", () => {
    const r = verify(logoFixed, { feeBps: 250 });
    // delivered+accepted, delivered+rejected, never delivered
    expect(r.outcomes.map((o) => [o.payeeCents, o.funderCents]).sort()).toEqual(
      [
        [10_000, 20_000],
        [10_000, 20_000],
        [30_000, 0],
      ].sort(),
    );
    expect(r.outcomes.every((o) => o.settled && o.stuckCents === 0 && o.example.length > 0)).toBe(true);
    expect(r.bounds).toMatchObject({
      payeeMinCents: 10_000,
      payeeMaxCents: 30_000,
      funderMinCents: 0,
      funderMaxCents: 20_000,
      feeMinCents: 250,
      feeMaxCents: 750,
      maxReleaseTransfers: 2,
      maxRefundTransfers: 1,
      earliestSettlementHours: 0,
      latestSettlementHours: 168 + 192,
    });
  });

  it("finds the deadline/review race in the naive logo contract", () => {
    const r = verify(logoNaive, { feeBps: 250 });
    expect(r.ok).toBe(false);
    const promise = r.properties.find((p) => p.id === "promise:designer_paid")!;
    expect(promise.status).toBe("violated");
    const steps = promise.counterexample!.steps.map((s) => s.event.type);
    // shortest counterexample: start, deliver on time, deadline fires while the review is pending
    expect(steps).toEqual(["activate", "submit", "deadline"]);
    expect(promise.counterexample!.outcome).toContain("$100.00");
    expect(r.properties.find((p) => p.id === "no_cutoff")!.status).toBe("violated");
    expect(r.properties.find((p) => p.id === "conservation")!.status).toBe("proved");
    expect(violationsForRepair(r)).toContain("promise:designer_paid");
  });

  it("proves the two-stage plumber contract", () => {
    const r = verify(plumberVisit, { feeBps: 250 });
    expect(r.summary).toMatch(/Proved/);
    expect(r.ok).toBe(true);
  });

  it("finds the out-of-order hole in the plumber draft", () => {
    const r = verify(plumberDraft, { feeBps: 250 });
    const p = r.properties.find((x) => x.id === "promise:no_show_refund")!;
    expect(p.status).toBe("violated");
    // repair photo first, accepted and paid, then nobody checks in
    expect(p.counterexample!.steps.map((s) => s.event.type)).toEqual(["activate", "submit", "accept", "deadline"]);
  });

  it("catches a rule that pays out more than is held", () => {
    const ir = clone(logoFixed);
    ir.clauses[0].actions[0] = { op: "release", cents: 25_000, remaining: false };
    ir.clauses.push({
      id: "bonus",
      label: "Bonus on acceptance",
      trigger: { on: "accepted", evidence: "final_svg", deadline: null },
      guard: [],
      actions: [{ op: "release", cents: 10_000, remaining: false }],
    });
    const r = verify(ir);
    const c = r.properties.find((p) => p.id === "conservation")!;
    expect(c.status).toBe("violated");
    // "pay the rest" fires first and empties the hold, then the bonus has nothing left to pay
    expect(c.counterexample!.outcome).toMatch(/tries to move \$100\.00 but only \$0\.00/);
  });

  it("catches money that can get stuck forever", () => {
    const ir = clone(logoFixed);
    ir.clauses = ir.clauses.filter((c) => c.id !== "rejected_refund");
    const r = verify(ir);
    const p = r.properties.find((x) => x.id === "no_stranded_funds")!;
    expect(p.status).toBe("violated");
    expect(p.counterexample!.steps.map((s) => s.event.type)).toContain("reject");
  });

  it("enforces PayPal's authorization window", () => {
    const ir = clone(logoFixed);
    // 20 days + worst-case review (192h) lands exactly on the 28-day budget: allowed
    ir.deadlines[0].afterHours = 24 * 20;
    expect(verify(ir).properties.find((p) => p.id === "paypal_window")!.status).toBe("proved");
    ir.deadlines[0].afterHours = 24 * 21;
    expect(verify(ir).properties.find((p) => p.id === "paypal_window")!.status).toBe("violated");
    ir.fundingMode = "escrow";
    expect(verify(ir).properties.find((p) => p.id === "paypal_window")!.status).toBe("proved");
  });

  it("reports dead rules", () => {
    const ir = clone(logoFixed);
    ir.clauses.push({
      id: "never",
      label: "Impossible rule",
      trigger: { on: "accepted", evidence: "final_svg", deadline: null },
      guard: [{ kind: "rejected", evidence: "final_svg", deadline: null, negate: false }],
      actions: [{ op: "refund", cents: null, remaining: true }],
    });
    expect(verify(ir).warnings.map((w) => w.code)).toContain("dead_clause");
  });
});

describe("validation", () => {
  it("accepts and normalizes valid input from untrusted JSON", () => {
    const raw = clone(logoFixed) as unknown as Record<string, unknown>;
    (raw as { title: string }).title = "  Logo  ";
    (raw as Record<string, unknown>).extra = "ignored";
    const v = validateContract(raw);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.title).toBe("Logo");
      expect("extra" in v.value).toBe(false);
    }
  });

  it("rejects bad ids, unknown references and impossible amounts", () => {
    const raw = clone(logoFixed) as ContractIR;
    raw.deadlines[0].id = "Bad-Id";
    raw.clauses[1].trigger.evidence = "missing";
    raw.clauses[0].actions[0].cents = 99_999_999;
    const v = validateContract(raw);
    expect(v.ok).toBe(false);
    const codes = v.issues.map((i) => i.code);
    expect(codes).toContain("id");
    expect(codes).toContain("unknown_ref");
    expect(codes).toContain("range");
  });

  it("verifyContract reports validation issues instead of throwing", () => {
    const r = verifyContract({ title: "x" });
    expect(r.valid).toBe(false);
  });

  it("hashes are independent of key order", () => {
    const reverseKeys = (x: unknown): unknown =>
      Array.isArray(x)
        ? x.map(reverseKeys)
        : x && typeof x === "object"
          ? Object.fromEntries(Object.entries(x).reverse().map(([k, val]) => [k, reverseKeys(val)]))
          : x;
    const shuffled = reverseKeys(logoFixed);
    const v = validateContract(shuffled);
    expect(v.ok && irHash(v.value)).toBe(irHash(logoFixed));
  });
});

describe("interpreter", () => {
  it("rejects events that are not allowed", () => {
    const s0 = initialState(logoFixed);
    expect(() => step(logoFixed, s0, { type: "submit", evidence: "final_svg" })).toThrow(EventRejected);
    const s1 = step(logoFixed, s0, { type: "activate" }).state;
    expect(() => step(logoFixed, s1, { type: "accept", evidence: "final_svg" })).toThrow(/not awaiting/);
  });

  it("both orders of a same-instant race end safely in the fixed contract", () => {
    const s1 = step(logoFixed, initialState(logoFixed), { type: "activate" }).state;
    // order A: delivery lands first, then the deadline
    const a1 = step(logoFixed, s1, { type: "submit", evidence: "final_svg" }).state;
    const a2 = step(logoFixed, a1, { type: "deadline", deadline: "delivery" }).state;
    const a3 = step(logoFixed, a2, { type: "accept", evidence: "final_svg" });
    expect(a3.state.releasedCents).toBe(30_000);
    expect(a3.closedNow).toBe(true);
    // order B: the deadline wins, the funder is refunded and late delivery is impossible
    const b1 = step(logoFixed, s1, { type: "deadline", deadline: "delivery" });
    expect(b1.state.refundedCents).toBe(20_000);
    expect(b1.state.closed).toBe(true);
  });

  it("consent exits move everything and close", () => {
    const s1 = step(logoFixed, initialState(logoFixed), { type: "activate" }).state;
    const r = step(logoFixed, s1, { type: "release_all" });
    expect(r.state.releasedCents).toBe(30_000);
    expect(r.state.closed).toBe(true);
  });
});

describe("rendering", () => {
  it("renders every rule and promise in plain English", () => {
    const r = renderContract(logoFixed, { feeBps: 250 });
    expect(r.rules).toHaveLength(4);
    expect(r.rules[1]).toContain("When “Final logo (SVG)” is accepted, if “Final logo (SVG)” was submitted before “Delivery deadline”");
    expect(r.promises[0]).toContain("at least $300.00");
    expect(r.money.join(" ")).toContain("2.50%");
  });
});
