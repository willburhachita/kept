/**
 * Convex validators that mirror the @kept/core types. The core validators
 * (validateContract / validateMandate) remain the source of truth for
 * semantics; these keep stored documents well-typed.
 */
import { v } from "convex/values";

const nullableString = v.union(v.string(), v.null());

export const currencyV = v.union(v.literal("USD"), v.literal("EUR"), v.literal("GBP"), v.literal("CAD"), v.literal("AUD"));
export const fundingModeV = v.union(v.literal("authorize"), v.literal("escrow"));
export const partyV = v.union(v.literal("funder"), v.literal("payee"));

export const literalV = v.object({
  kind: v.union(
    v.literal("submitted"),
    v.literal("submitted_before"),
    v.literal("accepted"),
    v.literal("rejected"),
    v.literal("deadline_passed"),
  ),
  evidence: nullableString,
  deadline: nullableString,
  negate: v.boolean(),
});

export const triggerV = v.object({
  on: v.union(v.literal("activated"), v.literal("accepted"), v.literal("rejected"), v.literal("deadline")),
  evidence: nullableString,
  deadline: nullableString,
});

export const moneyActionV = v.object({
  op: v.union(v.literal("release"), v.literal("refund")),
  cents: v.union(v.number(), v.null()),
  remaining: v.boolean(),
});

export const clauseV = v.object({
  id: v.string(),
  label: v.string(),
  trigger: triggerV,
  guard: v.array(literalV),
  actions: v.array(moneyActionV),
});

export const deadlineV = v.object({ id: v.string(), label: v.string(), afterHours: v.number() });

export const evidenceKindV = v.union(v.literal("file"), v.literal("text"), v.literal("link"));

export const evidenceSlotV = v.object({
  id: v.string(),
  label: v.string(),
  kind: evidenceKindV,
  criteria: v.array(v.string()),
  autoAcceptConfidence: v.number(),
});

export const guaranteeV = v.object({
  id: v.string(),
  label: v.string(),
  party: partyV,
  atLeastCents: v.number(),
  when: v.array(literalV),
});

export const contractIrV = v.object({
  irVersion: v.literal(1),
  title: v.string(),
  summary: v.string(),
  currency: currencyV,
  principalCents: v.number(),
  fundingMode: fundingModeV,
  challengeWindowHours: v.number(),
  deadlines: v.array(deadlineV),
  evidence: v.array(evidenceSlotV),
  guarantees: v.array(guaranteeV),
  clauses: v.array(clauseV),
});

export const machineStateV = v.object({
  activated: v.boolean(),
  closed: v.boolean(),
  passed: v.array(v.string()),
  evidence: v.array(
    v.object({
      id: v.string(),
      status: v.union(v.literal("none"), v.literal("pending"), v.literal("accepted"), v.literal("rejected")),
      before: v.array(v.string()),
    }),
  ),
  fired: v.array(v.string()),
  heldCents: v.number(),
  releasedCents: v.number(),
  refundedCents: v.number(),
});

export const mandatePolicyV = v.object({
  version: v.literal(1),
  title: v.string(),
  purpose: v.string(),
  currency: currencyV,
  budgetCents: v.number(),
  perPurchaseMaxCents: v.number(),
  maxPurchases: v.number(),
  expiresAfterHours: v.number(),
  allowedMerchants: v.array(v.string()),
  approvalAboveCents: v.union(v.number(), v.null()),
  maxPerHour: v.number(),
});

export const contractStatusV = v.union(
  v.literal("draft"),
  v.literal("compiling"),
  v.literal("verifying"),
  v.literal("review"),
  v.literal("needs_attention"),
  v.literal("awaiting_funding"),
  v.literal("funding"),
  v.literal("active"),
  v.literal("settling"),
  v.literal("settled"),
  v.literal("frozen"),
  v.literal("cancelled"),
);

export const mandateStatusV = v.union(
  v.literal("draft"),
  v.literal("awaiting_funding"),
  v.literal("funding"),
  v.literal("active"),
  v.literal("closing"),
  v.literal("closed"),
  v.literal("revoked"),
  v.literal("frozen"),
);

export const evidenceStatusV = v.union(
  v.literal("checking"),
  v.literal("challenge_window"),
  v.literal("awaiting_funder"),
  v.literal("funder_rejected"),
  v.literal("in_arbitration"),
  v.literal("accepted"),
  v.literal("rejected"),
);

export const effectKindV = v.union(
  v.literal("capture_authorization"),
  v.literal("protective_capture"),
  v.literal("payout"),
  v.literal("void_authorization"),
  v.literal("refund_capture"),
  v.literal("reauthorize"),
);

export const effectStatusV = v.union(v.literal("pending"), v.literal("in_flight"), v.literal("succeeded"), v.literal("failed"));

export const spendStatusV = v.union(
  v.literal("screening"),
  v.literal("needs_approval"),
  v.literal("executing"),
  v.literal("paid"),
  v.literal("denied"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const captureRecordV = v.object({
  captureId: v.string(),
  cents: v.number(),
  refundReservedCents: v.number(),
  refundedCents: v.number(),
  purpose: v.string(),
  at: v.number(),
  /** PayPal capture status (COMPLETED, PENDING, ...). */
  status: v.optional(v.string()),
  /** Payouts waiting for this PENDING capture to complete (released by webhook or the poller). */
  deferredPayouts: v.optional(v.array(v.object({ cents: v.number(), receiverEmail: v.string(), purpose: v.string(), spendId: v.optional(v.string()) }))),
});

/** PayPal funding state shared by contracts and mandates. */
export const fundingV = v.object({
  mode: fundingModeV,
  /** May switch from authorize to escrow when the expiry guard captures the remaining hold. */
  runtimeMode: fundingModeV,
  currency: currencyV,
  authorizationCents: v.number(),
  maxFeeCents: v.number(),
  orderId: v.optional(v.string()),
  approveUrl: v.optional(v.string()),
  orderCreatedAt: v.optional(v.number()),
  authorizationId: v.optional(v.string()),
  authorizedAt: v.optional(v.number()),
  honorEndsAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  reauthorizedAt: v.optional(v.number()),
  captures: v.array(captureRecordV),
  voided: v.optional(v.object({ cents: v.number(), at: v.number() })),
  converting: v.optional(v.boolean()),
  /** Escrow funding whose order capture is still PENDING at PayPal: activation waits for COMPLETED. */
  pendingCapture: v.optional(v.object({ captureId: v.string(), amountCents: v.number(), currency: v.string(), at: v.number() })),
  /** Checkouts closed before they completed (last 10). Money PayPal still takes on one is returned, never kept. */
  abandonedOrderIds: v.optional(v.array(v.string())),
});

/** Logical (what the contract decided) and execution (what PayPal confirmed) money. */
export const ledgerV = v.object({
  principalCents: v.number(),
  heldCents: v.number(),
  releasedCents: v.number(),
  refundedCents: v.number(),
  feesCents: v.number(),
  capturedCents: v.number(),
  paidOutCents: v.number(),
  refundExecutedCents: v.number(),
  voidedCents: v.number(),
});

export const approvalV = v.object({
  termsHash: v.string(),
  at: v.number(),
  /** Payee approvals lock the payout destination so it cannot be redirected later. */
  payoutEmail: v.optional(v.string()),
});

export const inviteV = v.object({
  email: v.optional(v.string()),
  role: partyV,
  tokenHash: v.string(),
  expiresAt: v.number(),
  acceptedAt: v.optional(v.number()),
  acceptedBy: v.optional(v.id("users")),
});
