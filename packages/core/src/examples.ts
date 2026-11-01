/**
 * Reference contracts. `logoNaive` is the one a first draft usually gets
 * wrong; the verifier finds the race and `logoFixed` is the repair.
 */
import type { ContractIR, Literal } from "./ir.js";
import type { MandatePolicy } from "./mandate.js";

const lit = (kind: Literal["kind"], evidence: string | null, deadline: string | null = null, negate = false): Literal => ({
  kind,
  evidence,
  deadline,
  negate,
});

const logoBase = {
  irVersion: 1 as const,
  title: "Logo design, milestone payment",
  summary:
    "Pay a designer $300: $100 up front, $200 when the final SVG logo is delivered and accepted within 7 days. Refund the rest if nothing arrives.",
  currency: "USD" as const,
  principalCents: 30_000,
  fundingMode: "authorize" as const,
  challengeWindowHours: 24,
  deadlines: [{ id: "delivery", label: "Delivery deadline", afterHours: 168 }],
  evidence: [
    {
      id: "final_svg",
      label: "Final logo (SVG)",
      kind: "file" as const,
      criteria: ["Is a vector SVG file", "Contains the brand name 'Acme'", "Uses no more than three colors"],
      autoAcceptConfidence: 0.85,
    },
  ],
  guarantees: [
    {
      id: "designer_paid",
      label: "Designer gets $300 for on-time delivery",
      party: "payee" as const,
      atLeastCents: 30_000,
      when: [lit("submitted_before", "final_svg", "delivery"), lit("rejected", "final_svg", null, true)],
    },
    {
      id: "client_refund",
      label: "Client gets $200 back if nothing arrives on time",
      party: "funder" as const,
      atLeastCents: 20_000,
      when: [lit("submitted_before", "final_svg", "delivery", true)],
    },
  ],
};

/** The draft a model (or a person) typically writes first. It has a race. */
export const logoNaive: ContractIR = {
  ...logoBase,
  clauses: [
    {
      id: "kickoff",
      label: "Upfront payment",
      trigger: { on: "activated", evidence: null, deadline: null },
      guard: [],
      actions: [{ op: "release", cents: 10_000, remaining: false }],
    },
    {
      id: "pay_on_delivery",
      label: "Pay the balance on delivery",
      trigger: { on: "accepted", evidence: "final_svg", deadline: null },
      guard: [],
      actions: [{ op: "release", cents: 20_000, remaining: false }],
    },
    {
      id: "late_refund",
      label: "Refund if not delivered by the deadline",
      trigger: { on: "deadline", evidence: null, deadline: "delivery" },
      guard: [lit("accepted", "final_svg", null, true)],
      actions: [{ op: "refund", cents: null, remaining: true }],
    },
  ],
};

/** The repaired version: waits for the review instead of racing it. */
export const logoFixed: ContractIR = {
  ...logoBase,
  clauses: [
    {
      id: "kickoff",
      label: "Upfront payment",
      trigger: { on: "activated", evidence: null, deadline: null },
      guard: [],
      actions: [{ op: "release", cents: 10_000, remaining: false }],
    },
    {
      id: "pay_on_delivery",
      label: "Pay the balance for an on-time delivery",
      trigger: { on: "accepted", evidence: "final_svg", deadline: null },
      guard: [lit("submitted_before", "final_svg", "delivery")],
      actions: [{ op: "release", cents: null, remaining: true }],
    },
    {
      id: "no_show_refund",
      label: "Refund if nothing was submitted by the deadline",
      trigger: { on: "deadline", evidence: null, deadline: "delivery" },
      guard: [lit("submitted", "final_svg", null, true)],
      actions: [{ op: "refund", cents: null, remaining: true }],
    },
    {
      id: "rejected_refund",
      label: "Refund if the delivery is rejected",
      trigger: { on: "rejected", evidence: "final_svg", deadline: null },
      guard: [],
      actions: [{ op: "refund", cents: null, remaining: true }],
    },
  ],
};

/**
 * A home-service booking: call-out fee on check-in, balance on completion.
 * This draft looks right but the verifier finds a hole: a repair photo sent
 * before the check-in gets paid, which breaks the no-show refund promise.
 */
export const plumberDraft: ContractIR = {
  irVersion: 1,
  title: "Plumber visit: call-out fee and repair",
  summary:
    "Homeowner holds $180. $40 call-out fee is released when the plumber checks in on site within 48 hours; $140 is released when the repair photo is accepted within 72 hours. No-show means a full refund.",
  currency: "USD",
  principalCents: 18_000,
  fundingMode: "authorize",
  challengeWindowHours: 12,
  deadlines: [
    { id: "arrival", label: "Arrival window", afterHours: 48 },
    { id: "completion", label: "Completion deadline", afterHours: 72 },
  ],
  evidence: [
    {
      id: "checkin",
      label: "On-site check-in photo",
      kind: "file",
      criteria: ["Photo taken at the job address (house number or front door visible)", "A technician or their tools are visible"],
      autoAcceptConfidence: 0.8,
    },
    {
      id: "repair",
      label: "Repair completed photo",
      kind: "file",
      criteria: ["Shows the repaired fixture", "No visible leak or water damage around it"],
      autoAcceptConfidence: 0.85,
    },
  ],
  guarantees: [
    {
      id: "callout_paid",
      label: "Plumber gets the $40 call-out fee for an on-time check-in",
      party: "payee",
      atLeastCents: 4_000,
      when: [lit("submitted_before", "checkin", "arrival"), lit("rejected", "checkin", null, true)],
    },
    {
      id: "fully_paid",
      label: "Plumber gets $180 for an on-time visit and repair",
      party: "payee",
      atLeastCents: 18_000,
      when: [
        lit("submitted_before", "checkin", "arrival"),
        lit("rejected", "checkin", null, true),
        lit("submitted_before", "repair", "completion"),
        lit("rejected", "repair", null, true),
      ],
    },
    {
      id: "no_show_refund",
      label: "Homeowner gets everything back if nobody shows up",
      party: "funder",
      atLeastCents: 18_000,
      when: [lit("submitted_before", "checkin", "arrival", true)],
    },
  ],
  clauses: [
    {
      id: "pay_callout",
      label: "Pay the call-out fee on check-in",
      trigger: { on: "accepted", evidence: "checkin", deadline: null },
      guard: [lit("submitted_before", "checkin", "arrival")],
      actions: [{ op: "release", cents: 4_000, remaining: false }],
    },
    {
      id: "no_show",
      label: "Full refund if nobody checked in",
      trigger: { on: "deadline", evidence: null, deadline: "arrival" },
      guard: [lit("submitted", "checkin", null, true)],
      actions: [{ op: "refund", cents: null, remaining: true }],
    },
    {
      id: "fake_checkin",
      label: "Refund everything if the check-in is rejected",
      trigger: { on: "rejected", evidence: "checkin", deadline: null },
      guard: [],
      actions: [{ op: "refund", cents: null, remaining: true }],
    },
    {
      id: "pay_repair",
      label: "Pay the repair on an accepted, on-time photo",
      trigger: { on: "accepted", evidence: "repair", deadline: null },
      guard: [lit("submitted_before", "repair", "completion")],
      actions: [{ op: "release", cents: 14_000, remaining: false }],
    },
    {
      id: "no_repair",
      label: "Refund the repair portion if no photo arrived",
      trigger: { on: "deadline", evidence: null, deadline: "completion" },
      guard: [lit("submitted", "repair", null, true)],
      actions: [{ op: "refund", cents: 14_000, remaining: false }],
    },
    {
      id: "repair_rejected",
      label: "Refund the repair portion if the photo is rejected",
      trigger: { on: "rejected", evidence: "repair", deadline: null },
      guard: [],
      actions: [{ op: "refund", cents: 14_000, remaining: false }],
    },
  ],
};

/**
 * The repaired booking: the repair is paid only once the check-in is also
 * accepted, whichever of the two reviews finishes last (a "join").
 */
export const plumberVisit: ContractIR = {
  ...plumberDraft,
  clauses: [
    plumberDraft.clauses[0],
    plumberDraft.clauses[1],
    plumberDraft.clauses[2],
    {
      id: "pay_repair",
      label: "Pay the repair once both photos are accepted (repair accepted last)",
      trigger: { on: "accepted", evidence: "repair", deadline: null },
      guard: [lit("submitted_before", "repair", "completion"), lit("accepted", "checkin")],
      actions: [{ op: "release", cents: 14_000, remaining: false }],
    },
    {
      id: "pay_repair_after_checkin",
      label: "Pay the repair once both photos are accepted (check-in accepted last)",
      trigger: { on: "accepted", evidence: "checkin", deadline: null },
      guard: [lit("accepted", "repair"), lit("submitted_before", "repair", "completion")],
      actions: [{ op: "release", cents: 14_000, remaining: false }],
    },
    plumberDraft.clauses[4],
    plumberDraft.clauses[5],
  ],
};

export const officeSuppliesMandate: MandatePolicy = {
  version: 1,
  title: "Office supplies agent",
  purpose: "Restock office supplies (paper, pens, printer ink, coffee) for a five-person team.",
  currency: "USD",
  budgetCents: 20_000,
  perPurchaseMaxCents: 5_000,
  maxPurchases: 10,
  expiresAfterHours: 168,
  allowedMerchants: ["@supplies.example.com", "orders@coffee.example.com"],
  approvalAboveCents: 3_000,
  maxPerHour: 5,
};

export const EXAMPLES = {
  logoNaive,
  logoFixed,
  plumberDraft,
  plumberVisit,
} as const;

export const EXAMPLE_PROMPTS = {
  logo: "Pay the designer $300. $100 now, $200 when she delivers the final logo as an SVG with our brand name Acme in at most three colors. Refund me if nothing arrives in 7 days.",
  plumber:
    "I'm booking a plumber for $180. He gets a $40 call-out fee once he checks in at my house within 48 hours, and the remaining $140 when he sends a photo of the fixed sink with no leaks within 72 hours. If he never shows up I want everything back.",
  mandate:
    "Let my purchasing agent restock office supplies for up to $200 this week, max $50 per order, only from supplies.example.com or orders@coffee.example.com, and ask me before anything over $30.",
} as const;
