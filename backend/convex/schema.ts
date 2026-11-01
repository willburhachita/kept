import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  approvalV,
  contractIrV,
  contractStatusV,
  currencyV,
  effectKindV,
  effectStatusV,
  evidenceKindV,
  evidenceStatusV,
  fundingV,
  inviteV,
  ledgerV,
  machineStateV,
  mandatePolicyV,
  mandateStatusV,
  spendStatusV,
} from "./lib/validators";

export default defineSchema({
  ...authTables,

  /** App-level user data. Created by the auth callback on sign-up. */
  profiles: defineTable({
    userId: v.id("users"),
    email: v.string(),
    displayName: v.string(),
    /** PayPal email that receives payouts when this user is a payee. */
    payoutEmail: v.optional(v.string()),
    role: v.union(v.literal("user"), v.literal("arbiter"), v.literal("admin")),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_email", ["email"])
    .index("by_role", ["role"]),

  contracts: defineTable({
    creatorId: v.id("users"),
    funderId: v.optional(v.id("users")),
    payeeId: v.optional(v.id("users")),
    status: contractStatusV,
    prompt: v.string(),
    version: v.number(),
    ir: v.optional(contractIrV),
    irHash: v.optional(v.string()),
    termsHash: v.optional(v.string()),
    verification: v.optional(
      v.object({ irHash: v.string(), ok: v.boolean(), summary: v.string(), verificationId: v.id("verifications") }),
    ),
    feeBps: v.number(),
    invite: v.optional(inviteV),
    approvals: v.object({ funder: v.optional(approvalV), payee: v.optional(approvalV) }),
    funding: v.optional(fundingV),
    activatedAt: v.optional(v.number()),
    deadlineTimes: v.optional(v.array(v.object({ id: v.string(), at: v.number() }))),
    machine: v.optional(machineStateV),
    ledger: ledgerV,
    frozen: v.optional(v.object({ reason: v.string(), at: v.number(), by: v.string() })),
    settledAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_funder", ["funderId"])
    .index("by_payee", ["payeeId"])
    .index("by_status", ["status"])
    .index("by_invite", ["invite.tokenHash"])
    .index("by_order", ["funding.orderId"]),

  /** Verification reports, content-addressed by (irHash, feeBps, engineVersion). */
  verifications: defineTable({
    irHash: v.string(),
    feeBps: v.number(),
    engineVersion: v.string(),
    ok: v.boolean(),
    summary: v.string(),
    report: v.any(),
    createdAt: v.number(),
  }).index("by_key", ["irHash", "feeBps", "engineVersion"]),

  /** Live progress of an AI compile: spec -> clauses -> verify -> repair rounds. */
  compileRuns: defineTable({
    contractId: v.id("contracts"),
    startedBy: v.id("users"),
    status: v.union(v.literal("running"), v.literal("succeeded"), v.literal("failed")),
    stage: v.string(),
    steps: v.array(
      v.object({
        kind: v.string(),
        ok: v.boolean(),
        title: v.string(),
        detail: v.string(),
        at: v.number(),
        data: v.optional(v.any()),
      }),
    ),
    assumptions: v.array(v.string()),
    questions: v.array(v.string()),
    model: v.string(),
    error: v.optional(v.string()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_contract", ["contractId", "startedAt"])
    .index("by_status", ["status", "startedAt"]),

  evidence: defineTable({
    contractId: v.id("contracts"),
    slotId: v.string(),
    submittedBy: v.id("users"),
    submittedAt: v.number(),
    kind: evidenceKindV,
    storageId: v.optional(v.id("_storage")),
    text: v.optional(v.string()),
    url: v.optional(v.string()),
    fileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
    sha256: v.optional(v.string()),
    /** Deadlines that had not passed at submission time (decides "on time"). */
    beforeDeadlines: v.array(v.string()),
    status: evidenceStatusV,
    ai: v.optional(v.any()),
    aiError: v.optional(v.string()),
    /** If the AI examiner has not answered by then, the evidence goes to the funder. */
    examinerDueAt: v.optional(v.number()),
    challengeEndsAt: v.optional(v.number()),
    funderDecisionDueAt: v.optional(v.number()),
    disputeEndsAt: v.optional(v.number()),
    arbitrationDueAt: v.optional(v.number()),
    challenge: v.optional(v.object({ by: v.id("users"), reason: v.string(), at: v.number() })),
    dispute: v.optional(v.object({ by: v.id("users"), reason: v.string(), at: v.number() })),
    decision: v.optional(
      v.object({ by: v.string(), outcome: v.union(v.literal("accepted"), v.literal("rejected")), reason: v.string(), at: v.number() }),
    ),
  })
    .index("by_contract", ["contractId"])
    .index("by_contract_slot", ["contractId", "slotId"])
    .index("by_status", ["status"]),

  /** Transactional outbox of PayPal calls. Processed strictly in order per stream. */
  effects: defineTable({
    stream: v.string(),
    streamKind: v.union(v.literal("contract"), v.literal("mandate")),
    seq: v.number(),
    kind: effectKindV,
    params: v.any(),
    status: effectStatusV,
    attempts: v.number(),
    nextAttemptAt: v.number(),
    lastError: v.optional(v.string()),
    result: v.optional(v.any()),
    ref: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_stream_seq", ["stream", "seq"])
    .index("by_status_next", ["status", "nextAttemptAt"])
    .index("by_status_updated", ["status", "updatedAt"]),

  /** Double-entry style money log per stream. */
  ledgerEntries: defineTable({
    stream: v.string(),
    seq: v.number(),
    at: v.number(),
    kind: v.string(),
    cents: v.number(),
    from: v.string(),
    to: v.string(),
    memo: v.optional(v.string()),
    ref: v.optional(v.string()),
  }).index("by_stream", ["stream", "seq"]),

  /** Append-only, hash-chained, Ed25519-signed event journal (one chain per stream). */
  journal: defineTable({
    stream: v.string(),
    seq: v.number(),
    at: v.number(),
    actor: v.string(),
    type: v.string(),
    data: v.any(),
    prevHash: v.string(),
    hash: v.string(),
    sig: v.string(),
    keyId: v.string(),
    /** Transparency checkpoint this entry was sealed into (null until then). */
    checkpoint: v.union(v.number(), v.null()),
    leafIndex: v.optional(v.number()),
  })
    .index("by_stream_seq", ["stream", "seq"])
    .index("by_checkpoint", ["checkpoint", "leafIndex"])
    .index("by_hash", ["hash"]),

  journalHeads: defineTable({ stream: v.string(), seq: v.number(), hash: v.string() }).index("by_stream", ["stream"]),

  /** Signed Merkle roots over all journal entries (RFC 6962 transparency log). */
  checkpoints: defineTable({
    seq: v.number(),
    size: v.number(),
    root: v.string(),
    prevHash: v.string(),
    hash: v.string(),
    sig: v.string(),
    keyId: v.string(),
    at: v.number(),
  }).index("by_seq", ["seq"]),

  notifications: defineTable({
    userId: v.id("users"),
    kind: v.string(),
    title: v.string(),
    body: v.string(),
    stream: v.optional(v.string()),
    read: v.boolean(),
    at: v.number(),
  })
    .index("by_user", ["userId", "at"])
    .index("by_user_read", ["userId", "read", "at"]),

  mandates: defineTable({
    ownerId: v.id("users"),
    status: mandateStatusV,
    prompt: v.optional(v.string()),
    policy: mandatePolicyV,
    policyHash: v.string(),
    feeBps: v.number(),
    report: v.optional(v.any()),
    funding: v.optional(fundingV),
    activatedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    spentCents: v.number(),
    reservedCents: v.number(),
    feesCents: v.number(),
    purchases: v.number(),
    recentSpendTimes: v.array(v.number()),
    ledger: ledgerV,
    frozen: v.optional(v.object({ reason: v.string(), at: v.number(), by: v.string() })),
    closedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"])
    .index("by_order", ["funding.orderId"]),

  /** Agent credentials. Only the SHA-256 of the token is stored. */
  agentTokens: defineTable({
    mandateId: v.id("mandates"),
    ownerId: v.id("users"),
    tokenHash: v.string(),
    prefix: v.string(),
    label: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_hash", ["tokenHash"])
    .index("by_mandate", ["mandateId"]),

  spends: defineTable({
    mandateId: v.id("mandates"),
    tokenId: v.id("agentTokens"),
    idempotencyKey: v.string(),
    merchantEmail: v.string(),
    merchantName: v.string(),
    amountCents: v.number(),
    feeCents: v.number(),
    currency: currencyV,
    description: v.string(),
    status: spendStatusV,
    reasons: v.array(v.string()),
    review: v.optional(v.any()),
    decidedBy: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    payoutBatchId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_mandate", ["mandateId", "createdAt"])
    .index("by_token_key", ["tokenId", "idempotencyKey"])
    .index("by_status", ["status"]),

  /** Developer API keys for the REST API. Only the SHA-256 is stored. */
  apiKeys: defineTable({
    userId: v.id("users"),
    keyHash: v.string(),
    prefix: v.string(),
    label: v.string(),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_hash", ["keyHash"])
    .index("by_user", ["userId"]),

  rateLimits: defineTable({ key: v.string(), tokens: v.number(), updatedAt: v.number() }).index("by_key", ["key"]),

  /** Inbound PayPal webhook events (dedupe + audit). */
  webhookEvents: defineTable({
    eventId: v.string(),
    type: v.string(),
    receivedAt: v.number(),
    status: v.union(v.literal("processed"), v.literal("ignored"), v.literal("failed")),
    resourceId: v.optional(v.string()),
    note: v.optional(v.string()),
  }).index("by_event", ["eventId"]),

  /** Outbound webhooks to developers (Standard Webhooks signatures). */
  webhookEndpoints: defineTable({
    userId: v.id("users"),
    url: v.string(),
    secret: v.string(),
    events: v.array(v.string()),
    failures: v.number(),
    createdAt: v.number(),
    disabledAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  webhookDeliveries: defineTable({
    endpointId: v.id("webhookEndpoints"),
    userId: v.id("users"),
    journalId: v.id("journal"),
    eventType: v.string(),
    status: v.union(v.literal("pending"), v.literal("delivered"), v.literal("failed")),
    attempts: v.number(),
    nextAttemptAt: v.number(),
    lastError: v.optional(v.string()),
    responseStatus: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_next", ["status", "nextAttemptAt"])
    .index("by_endpoint", ["endpointId", "createdAt"]),
});
