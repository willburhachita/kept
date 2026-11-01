/**
 * Contracts: create, invite, set terms, approve, read.
 *
 * Every operation is a plain function (ctx, userId, args) exposed twice: as a
 * public function for signed-in clients, and as an internal "...As" function
 * for the REST API, which authenticates with API keys instead of sessions.
 */
import {
  ENGINE_VERSION,
  formatCents,
  irHash as computeIrHash,
  nextDeadline,
  renderContract,
  sha256Hex,
  termsHash as computeTermsHash,
  validateContract,
} from "@kept/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import { assertEmail, getProfile, isParticipant, loadContract, maskEmail, readableContract, requireProfile, requireRole, requireUserId, roleIn } from "./lib/authz";
import { env, signingKey } from "./lib/env";
import { fail } from "./lib/errors";
import { actorUser, appendJournal, type Actor } from "./lib/journal";
import { notify } from "./lib/notify";
import { LIMITS, rateLimit } from "./lib/rateLimit";
import { hashSecret, issueSecret } from "./lib/secrets";
import { partyV } from "./lib/validators";

const DAY = 86_400_000;
const MAX_PROMPT = 4000;
const PRE_FUNDING = ["draft", "compiling", "verifying", "review", "needs_attention", "awaiting_funding", "funding"] as const;
const EDITABLE = ["draft", "review", "needs_attention", "verifying"] as const;

const emptyLedger = (principalCents: number) => ({
  principalCents,
  heldCents: 0,
  releasedCents: 0,
  refundedCents: 0,
  feesCents: 0,
  capturedCents: 0,
  paidOutCents: 0,
  refundExecutedCents: 0,
  voidedCents: 0,
});

export function computeTerms(c: Pick<Doc<"contracts">, "irHash" | "funderId" | "payeeId" | "feeBps">): string | undefined {
  if (!c.irHash || !c.funderId || !c.payeeId) return undefined;
  return computeTermsHash({ irHash: c.irHash, funderId: c.funderId, payeeId: c.payeeId, feeBps: c.feeBps, engineVersion: ENGINE_VERSION });
}

/** Validate and install new terms; resets approvals and schedules verification. */
export async function applyTerms(ctx: MutationCtx, c: Doc<"contracts">, raw: unknown, actor: Actor, source: string): Promise<{ irHash: string }> {
  if (!(EDITABLE as readonly string[]).includes(c.status)) fail("INVALID_STATE", `Terms cannot change while the contract is ${c.status}.`);
  const res = validateContract(raw);
  if (!res.ok) {
    fail("INVALID_ARGUMENT", "The contract is not valid.", {
      issues: res.issues.filter((i) => i.severity === "error").slice(0, 20).map((i) => `${i.path}: ${i.message}`),
    });
  }
  const ir = res.value;
  const irHash = computeIrHash(ir);
  const termsHash = computeTerms({ ...c, irHash });
  await ctx.db.patch(c._id, {
    ir,
    irHash,
    termsHash,
    version: c.version + 1,
    approvals: {},
    verification: undefined,
    status: "verifying",
    ledger: emptyLedger(ir.principalCents),
    updatedAt: Date.now(),
  });
  await appendJournal(ctx, c._id, actor, "terms.set", { irHash, version: c.version + 1, source, termsHash: termsHash ?? null });
  await ctx.scheduler.runAfter(0, internal.verification.run, { contractId: c._id, irHash });
  return { irHash };
}

// ---------------------------------------------------------------------------
// Create + invite
// ---------------------------------------------------------------------------

export const _create = internalMutation({
  args: {
    userId: v.id("users"),
    prompt: v.string(),
    role: partyV,
    counterpartyEmail: v.optional(v.string()),
    inviteHash: v.string(),
    ir: v.optional(v.any()),
  },
  handler: async (ctx, a) => {
    await rateLimit(ctx, `create:${a.userId}`, LIMITS.createContract);
    const prompt = a.prompt.trim();
    if (!prompt && !a.ir) fail("INVALID_ARGUMENT", "Describe the agreement in plain words.");
    if (prompt.length > MAX_PROMPT) fail("INVALID_ARGUMENT", `Keep the description under ${MAX_PROMPT} characters.`);
    const email = a.counterpartyEmail ? assertEmail(a.counterpartyEmail, "counterpartyEmail") : undefined;
    const me = await requireProfile(ctx, a.userId);
    if (email && email === me.email) fail("INVALID_ARGUMENT", "Invite someone other than yourself.");
    const now = Date.now();
    const contractId = await ctx.db.insert("contracts", {
      creatorId: a.userId,
      funderId: a.role === "funder" ? a.userId : undefined,
      payeeId: a.role === "payee" ? a.userId : undefined,
      status: "draft",
      prompt,
      version: 0,
      feeBps: env.feeBps(),
      invite: { email, role: a.role === "funder" ? "payee" : "funder", tokenHash: a.inviteHash, expiresAt: now + 14 * DAY },
      approvals: {},
      ledger: emptyLedger(0),
      createdAt: now,
      updatedAt: now,
    });
    await appendJournal(ctx, contractId, actorUser(a.userId), "contract.created", {
      creatorRole: a.role,
      promptSha256: sha256Hex(prompt),
      invitedEmail: maskEmail(email),
    });
    if (a.ir !== undefined && a.ir !== null) {
      const c = await loadContract(ctx, contractId);
      await applyTerms(ctx, c, a.ir, actorUser(a.userId), "create");
    }
    return contractId;
  },
});

async function createFlow(
  ctx: ActionCtx,
  userId: Id<"users">,
  args: { prompt: string; role: "funder" | "payee"; counterpartyEmail?: string; ir?: unknown },
) {
  const invite = issueSecret("inv");
  const contractId: Id<"contracts"> = await ctx.runMutation(internal.contracts._create, {
    userId,
    prompt: args.prompt,
    role: args.role,
    counterpartyEmail: args.counterpartyEmail,
    inviteHash: invite.hash,
    ir: args.ir,
  });
  return { contractId, inviteToken: invite.token, inviteUrl: `${env.siteUrl()}/invite/${invite.token}` };
}

const createArgs = {
  prompt: v.string(),
  role: partyV,
  counterpartyEmail: v.optional(v.string()),
  /** Optional ready-made contract (template or hand-written); otherwise compile from the prompt. */
  ir: v.optional(v.any()),
};

/** Create a contract and get a one-time invite link for the other side. */
export const create = action({
  args: createArgs,
  handler: async (ctx, args) => createFlow(ctx, await requireUserId(ctx), args),
});

export const createAs = internalAction({
  args: { userId: v.id("users"), ...createArgs },
  handler: async (ctx, { userId, ...args }) => createFlow(ctx, userId, args),
});

export const _replaceInvite = internalMutation({
  args: { userId: v.id("users"), contractId: v.id("contracts"), inviteHash: v.string(), email: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const c = await loadContract(ctx, a.contractId);
    if (c.creatorId !== a.userId) fail("FORBIDDEN", "Only the creator can manage the invite.");
    if (c.funderId && c.payeeId) fail("INVALID_STATE", "Both parties have already joined.");
    if (!(PRE_FUNDING as readonly string[]).includes(c.status)) fail("INVALID_STATE", `Contract is ${c.status}.`);
    await rateLimit(ctx, `invite:${a.userId}`, LIMITS.secretIssue);
    const email = a.email ? assertEmail(a.email, "email") : c.invite?.email;
    await ctx.db.patch(c._id, {
      invite: { email, role: c.funderId ? "payee" : "funder", tokenHash: a.inviteHash, expiresAt: Date.now() + 14 * DAY },
      updatedAt: Date.now(),
    });
    await appendJournal(ctx, c._id, actorUser(a.userId), "invite.reissued", { invitedEmail: maskEmail(email) });
  },
});

/** Creator: issue a fresh invite link (the old one stops working). */
export const regenerateInvite = action({
  args: { contractId: v.id("contracts"), email: v.optional(v.string()) },
  handler: async (ctx, { contractId, email }) => {
    const userId = await requireUserId(ctx);
    const invite = issueSecret("inv");
    await ctx.runMutation(internal.contracts._replaceInvite, { userId, contractId, inviteHash: invite.hash, email });
    return { inviteToken: invite.token, inviteUrl: `${env.siteUrl()}/invite/${invite.token}` };
  },
});

async function acceptInviteFlow(ctx: MutationCtx, userId: Id<"users">, token: string) {
  await rateLimit(ctx, `accept:${userId}`, LIMITS.inviteAccept);
  const c = await ctx.db
    .query("contracts")
    .withIndex("by_invite", (q) => q.eq("invite.tokenHash", hashSecret(token)))
    .first();
  if (!c || !c.invite) fail("NOT_FOUND", "This invite link is invalid or has expired.");
  if (c.invite.acceptedAt) {
    if (c.invite.acceptedBy === userId) return { contractId: c._id };
    fail("CONFLICT", "This invite was already used.");
  }
  if (c.invite.expiresAt < Date.now()) fail("NOT_FOUND", "This invite link is invalid or has expired.");
  if (c.creatorId === userId || roleIn(c, userId)) fail("INVALID_ARGUMENT", "You are already part of this contract.");
  if (c.status === "cancelled") fail("INVALID_STATE", "This contract was cancelled.");
  const me = await requireProfile(ctx, userId);
  if (c.invite.email && c.invite.email !== me.email) fail("FORBIDDEN", "This invite is for a different email address.");
  const role = c.invite.role;
  if ((role === "funder" && c.funderId) || (role === "payee" && c.payeeId)) fail("CONFLICT", "That role is already taken.");
  const now = Date.now();
  const updated = { ...c, funderId: role === "funder" ? userId : c.funderId, payeeId: role === "payee" ? userId : c.payeeId };
  const termsHash = computeTerms(updated);
  await ctx.db.patch(c._id, {
    funderId: updated.funderId,
    payeeId: updated.payeeId,
    termsHash,
    approvals: {},
    invite: { ...c.invite, acceptedAt: now, acceptedBy: userId },
    status: c.status === "awaiting_funding" ? "review" : c.status,
    updatedAt: now,
  });
  await appendJournal(ctx, c._id, actorUser(userId), "contract.joined", { role, termsHash: termsHash ?? null });
  await notify(ctx, c.creatorId, {
    kind: "contract.joined",
    title: `${me.displayName} joined as ${role}`,
    body: c.ir?.title ?? c.prompt.slice(0, 120),
    stream: c._id,
  });
  return { contractId: c._id };
}

/** Counterparty: accept an invite link and take the open role. */
export const acceptInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => acceptInviteFlow(ctx, await requireUserId(ctx), token),
});

export const acceptInviteAs = internalMutation({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, { userId, token }) => acceptInviteFlow(ctx, userId, token),
});

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

async function setTermsFlow(ctx: MutationCtx, userId: Id<"users">, contractId: Id<"contracts">, ir: unknown) {
  const c = await loadContract(ctx, contractId);
  if (!isParticipant(c, userId)) fail("NOT_FOUND", "Contract not found.");
  return await applyTerms(ctx, c, ir, actorUser(userId), "manual");
}

/** Set terms directly (template or hand-edited contract). Verification runs automatically. */
export const setTerms = mutation({
  args: { contractId: v.id("contracts"), ir: v.any() },
  handler: async (ctx, { contractId, ir }) => setTermsFlow(ctx, await requireUserId(ctx), contractId, ir),
});

export const setTermsAs = internalMutation({
  args: { userId: v.id("users"), contractId: v.id("contracts"), ir: v.any() },
  handler: async (ctx, { userId, contractId, ir }) => setTermsFlow(ctx, userId, contractId, ir),
});

/** Edit the plain-language description (before funding). Recompile afterwards. */
export const updatePrompt = mutation({
  args: { contractId: v.id("contracts"), prompt: v.string() },
  handler: async (ctx, { contractId, prompt }) => {
    const userId = await requireUserId(ctx);
    const c = await loadContract(ctx, contractId);
    if (!isParticipant(c, userId)) fail("NOT_FOUND", "Contract not found.");
    if (!(EDITABLE as readonly string[]).includes(c.status)) fail("INVALID_STATE", `Contract is ${c.status}.`);
    const p = prompt.trim();
    if (!p || p.length > MAX_PROMPT) fail("INVALID_ARGUMENT", `Description must be 1-${MAX_PROMPT} characters.`);
    await ctx.db.patch(c._id, { prompt: p, approvals: {}, updatedAt: Date.now() });
    await appendJournal(ctx, c._id, actorUser(userId), "prompt.updated", { promptSha256: sha256Hex(p) });
  },
});

async function approveFlow(ctx: MutationCtx, userId: Id<"users">, contractId: Id<"contracts">, termsHash: string) {
  const c = await loadContract(ctx, contractId);
  const role = requireRole(c, userId, ["funder", "payee"]);
  if (c.status !== "review") fail("INVALID_STATE", `Contract is ${c.status}; only verified terms in review can be approved.`);
  if (!c.termsHash || c.termsHash !== termsHash) fail("CONFLICT", "The terms changed. Review the latest version and approve again.");
  if (computeTerms(c) !== c.termsHash) fail("CONFLICT", "Terms binding is stale.");
  if (c.verification?.ok !== true || c.verification.irHash !== c.irHash) fail("VERIFICATION_FAILED", "Terms are not verified.");
  let payoutEmail: string | undefined;
  if (role === "payee") {
    const me = await requireProfile(ctx, userId);
    if (!me.payoutEmail) fail("INVALID_STATE", "Add the PayPal email you want to be paid at (profile) before approving.");
    payoutEmail = me.payoutEmail;
  }
  const approvals = { ...c.approvals, [role]: { termsHash, at: Date.now(), ...(payoutEmail ? { payoutEmail } : {}) } };
  const both = approvals.funder?.termsHash === termsHash && approvals.payee?.termsHash === termsHash;
  await ctx.db.patch(c._id, { approvals, status: both ? "awaiting_funding" : "review", updatedAt: Date.now() });
  await appendJournal(ctx, c._id, actorUser(userId), "terms.approved", { role, termsHash, payoutEmail: maskEmail(payoutEmail) });
  const other = role === "funder" ? c.payeeId : c.funderId;
  await notify(ctx, other, {
    kind: both ? "terms.ready_to_fund" : "terms.approved",
    title: both ? "Both sides approved: ready to fund" : `The ${role} approved the terms`,
    body: c.ir?.title ?? "",
    stream: c._id,
  });
  return { status: both ? "awaiting_funding" : "review" };
}

/** Approve the exact verified terms (by hash). Payees lock their payout email here. */
export const approve = mutation({
  args: { contractId: v.id("contracts"), termsHash: v.string() },
  handler: async (ctx, { contractId, termsHash }) => approveFlow(ctx, await requireUserId(ctx), contractId, termsHash),
});

export const approveAs = internalMutation({
  args: { userId: v.id("users"), contractId: v.id("contracts"), termsHash: v.string() },
  handler: async (ctx, { userId, contractId, termsHash }) => approveFlow(ctx, userId, contractId, termsHash),
});

async function cancelFlow(ctx: MutationCtx, userId: Id<"users">, contractId: Id<"contracts">) {
  const c = await loadContract(ctx, contractId);
  if (!isParticipant(c, userId)) fail("NOT_FOUND", "Contract not found.");
  if (!(PRE_FUNDING as readonly string[]).includes(c.status)) fail("INVALID_STATE", `A ${c.status} contract cannot be cancelled.`);
  // The buyer may already have approved on PayPal; the funder must reset the checkout first.
  if (c.status === "funding" && c.funding?.orderId) fail("INVALID_STATE", "A PayPal checkout is open. Reset funding first, then cancel.");
  await ctx.db.patch(c._id, { status: "cancelled", cancelledAt: Date.now(), updatedAt: Date.now() });
  await appendJournal(ctx, c._id, actorUser(userId), "contract.cancelled", { previousStatus: c.status });
  const other = c.funderId === userId ? c.payeeId : c.funderId;
  await notify(ctx, other, { kind: "contract.cancelled", title: "Contract cancelled", body: c.ir?.title ?? c.prompt.slice(0, 120), stream: c._id });
}

/** Cancel before funding. */
export const cancel = mutation({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }) => cancelFlow(ctx, await requireUserId(ctx), contractId),
});

export const cancelAs = internalMutation({
  args: { userId: v.id("users"), contractId: v.id("contracts") },
  handler: async (ctx, { userId, contractId }) => cancelFlow(ctx, userId, contractId),
});

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

async function partyCard(ctx: QueryCtx, userId: Id<"users"> | undefined, reveal: boolean) {
  if (!userId) return null;
  const p = await getProfile(ctx, userId);
  return {
    userId,
    displayName: p?.displayName ?? "Unknown",
    email: reveal ? (p?.email ?? null) : maskEmail(p?.email),
    hasPayoutEmail: Boolean(p?.payoutEmail),
  };
}

/** Everything a contract screen needs, already filtered for the viewer. */
export async function contractView(ctx: QueryCtx, userId: Id<"users">, contractId: Id<"contracts">) {
  const { contract: c, role, staff } = await readableContract(ctx, contractId, userId);
  const isCreator = c.creatorId === userId;
  const verification = c.verification ? await ctx.db.get(c.verification.verificationId) : null;
  const now = Date.now();
  const deadlines = (c.ir?.deadlines ?? []).map((d) => {
    const at = c.deadlineTimes?.find((x) => x.id === d.id)?.at ?? null;
    return { id: d.id, label: d.label, afterHours: d.afterHours, at, passed: c.machine?.passed.includes(d.id) ?? false };
  });
  const next = c.ir && c.machine ? nextDeadline(c.ir, c.machine) : null;

  const actions: string[] = [];
  const pre = (PRE_FUNDING as readonly string[]).includes(c.status);
  if ((EDITABLE as readonly string[]).includes(c.status) && (isCreator || role)) actions.push("compile", "edit_terms");
  if (c.status === "review" && role && c.approvals[role]?.termsHash !== c.termsHash) actions.push("approve");
  if (role === "funder" && c.status === "awaiting_funding") actions.push("fund");
  const checkoutOpen = c.status === "funding" && Boolean(c.funding?.orderId);
  if (role === "funder" && c.status === "funding") actions.push("confirm_funding");
  if (role === "funder" && checkoutOpen && !c.funding?.pendingCapture) actions.push("reset_funding");
  if (role === "payee" && c.status === "active" && c.machine && c.ir) {
    const windowOpen = c.machine.passed.length < c.ir.deadlines.length;
    for (const e of c.machine.evidence) if (e.status === "none" && windowOpen) actions.push(`submit_evidence:${e.id}`);
    actions.push("refund_all");
  }
  if (role === "funder" && c.status === "active") actions.push("release_all");
  if (pre && !checkoutOpen && (isCreator || role)) actions.push("cancel");
  if (isCreator && pre && !(c.funderId && c.payeeId)) actions.push("share_invite");

  return {
    _id: c._id,
    status: c.status,
    version: c.version,
    prompt: c.prompt,
    myRole: role,
    isCreator,
    staff,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    parties: {
      funder: await partyCard(ctx, c.funderId, staff || c.funderId === userId),
      payee: await partyCard(ctx, c.payeeId, staff || c.payeeId === userId),
    },
    invite: isCreator && c.invite ? { email: c.invite.email ?? null, role: c.invite.role, expiresAt: c.invite.expiresAt, accepted: Boolean(c.invite.acceptedAt) } : null,
    ir: c.ir ?? null,
    irHash: c.irHash ?? null,
    termsHash: c.termsHash ?? null,
    feeBps: c.feeBps,
    rendered: c.ir ? renderContract(c.ir, { feeBps: c.feeBps }) : null,
    verification: verification
      ? { ok: verification.ok, summary: verification.summary, irHash: verification.irHash, report: verification.report, current: verification.irHash === c.irHash }
      : null,
    approvals: {
      funder: c.approvals.funder?.termsHash === c.termsHash && Boolean(c.termsHash),
      payee: c.approvals.payee?.termsHash === c.termsHash && Boolean(c.termsHash),
    },
    funding: c.funding
      ? {
          mode: c.funding.mode,
          runtimeMode: c.funding.runtimeMode,
          currency: c.funding.currency,
          authorizationCents: c.funding.authorizationCents,
          maxFeeCents: c.funding.maxFeeCents,
          approveUrl: role === "funder" && c.status === "funding" ? (c.funding.approveUrl ?? null) : null,
          authorizedAt: c.funding.authorizedAt ?? null,
          honorEndsAt: c.funding.honorEndsAt ?? null,
          expiresAt: c.funding.expiresAt ?? null,
          capturedCents: c.ledger.capturedCents,
          captures: c.funding.captures.length,
          voided: c.funding.voided ?? null,
        }
      : null,
    activatedAt: c.activatedAt ?? null,
    deadlines,
    nextDeadline: next ? (deadlines.find((d) => d.id === next) ?? null) : null,
    machine: c.machine ?? null,
    ledger: c.ledger,
    money: c.ir
      ? {
          principal: formatCents(c.ledger.principalCents, c.ir.currency),
          held: formatCents(c.ledger.heldCents, c.ir.currency),
          released: formatCents(c.ledger.releasedCents, c.ir.currency),
          refunded: formatCents(c.ledger.refundedCents, c.ir.currency),
          fees: formatCents(c.ledger.feesCents, c.ir.currency),
        }
      : null,
    frozen: c.frozen ?? null,
    settledAt: c.settledAt ?? null,
    nextActions: actions,
    serverTime: now,
  };
}

export const get = query({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }) => contractView(ctx, await requireUserId(ctx), contractId),
});

export const getAs = internalQuery({
  args: { userId: v.id("users"), contractId: v.id("contracts") },
  handler: async (ctx, { userId, contractId }) => contractView(ctx, userId, contractId),
});

async function listFlow(ctx: QueryCtx, userId: Id<"users">) {
  const [created, funding, paying] = await Promise.all([
    ctx.db.query("contracts").withIndex("by_creator", (q) => q.eq("creatorId", userId)).order("desc").take(200),
    ctx.db.query("contracts").withIndex("by_funder", (q) => q.eq("funderId", userId)).order("desc").take(200),
    ctx.db.query("contracts").withIndex("by_payee", (q) => q.eq("payeeId", userId)).order("desc").take(200),
  ]);
  const byId = new Map<string, Doc<"contracts">>();
  for (const c of [...created, ...funding, ...paying]) byId.set(c._id, c);
  return [...byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => ({
      _id: c._id,
      title: c.ir?.title ?? (c.prompt.slice(0, 80) || "Untitled contract"),
      status: c.status,
      myRole: roleIn(c, userId),
      isCreator: c.creatorId === userId,
      principalCents: c.ir?.principalCents ?? null,
      currency: c.ir?.currency ?? null,
      heldCents: c.ledger.heldCents,
      releasedCents: c.ledger.releasedCents,
      verified: c.verification?.ok === true && c.verification.irHash === c.irHash,
      counterpartyJoined: Boolean(c.funderId && c.payeeId),
      updatedAt: c.updatedAt,
    }));
}

export const listMine = query({
  args: {},
  handler: async (ctx) => listFlow(ctx, await requireUserId(ctx)),
});

export const listAs = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => listFlow(ctx, userId),
});

async function journalFlow(ctx: QueryCtx, userId: Id<"users">, contractId: Id<"contracts">, limit: number) {
  await readableContract(ctx, contractId, userId);
  const entries = await ctx.db
    .query("journal")
    .withIndex("by_stream_seq", (q) => q.eq("stream", contractId))
    .order("desc")
    .take(Math.min(Math.max(limit, 1), 500));
  return entries.reverse().map((e) => ({
    seq: e.seq,
    at: e.at,
    actor: e.actor,
    type: e.type,
    data: e.data,
    hash: e.hash,
    prevHash: e.prevHash,
    sig: e.sig,
    keyId: e.keyId,
    checkpoint: e.checkpoint,
  }));
}

/** The signed, hash-chained timeline of a contract. */
export const journal = query({
  args: { contractId: v.id("contracts"), limit: v.optional(v.number()) },
  handler: async (ctx, { contractId, limit }) => journalFlow(ctx, await requireUserId(ctx), contractId, limit ?? 200),
});

export const journalAs = internalQuery({
  args: { userId: v.id("users"), contractId: v.id("contracts"), limit: v.optional(v.number()) },
  handler: async (ctx, { userId, contractId, limit }) => journalFlow(ctx, userId, contractId, limit ?? 200),
});

async function proofFlow(ctx: QueryCtx, userId: Id<"users">, contractId: Id<"contracts">) {
  const { contract: c } = await readableContract(ctx, contractId, userId);
  const verification = c.verification ? await ctx.db.get(c.verification.verificationId) : null;
  const entries = await ctx.db
    .query("journal")
    .withIndex("by_stream_seq", (q) => q.eq("stream", contractId))
    .take(5000);
  const key = signingKey();
  return {
    format: "kept-proof-pack/v1",
    contractId: c._id,
    status: c.status,
    ir: c.ir ?? null,
    irHash: c.irHash ?? null,
    termsHash: c.termsHash ?? null,
    feeBps: c.feeBps,
    engineVersion: ENGINE_VERSION,
    verification: verification ? { ok: verification.ok, summary: verification.summary, report: verification.report } : null,
    journal: entries.map((e) => ({
      stream: e.stream,
      seq: e.seq,
      at: e.at,
      actor: e.actor,
      type: e.type,
      data: e.data,
      prevHash: e.prevHash,
      hash: e.hash,
      sig: e.sig,
      keyId: e.keyId,
      checkpoint: e.checkpoint,
      leafIndex: e.leafIndex ?? null,
    })),
    signingKeys: { [key.keyId]: key.publicKeyHex },
    howToVerify:
      "npx @kept/mcp verify-proof <file>  or  import { verifyChain, verifyContract } from '@kept/core'. Re-run verifyContract(ir) to reproduce the report; verifyChain(journal, signingKeys) checks every hash and signature.",
  };
}

/** Downloadable proof pack: terms, verification report and the signed journal. */
export const proof = query({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }) => proofFlow(ctx, await requireUserId(ctx), contractId),
});

export const proofAs = internalQuery({
  args: { userId: v.id("users"), contractId: v.id("contracts") },
  handler: async (ctx, { userId, contractId }) => proofFlow(ctx, userId, contractId),
});

/** Internal: minimal contract snapshot for actions (compiler, examiner). */
export const _snapshot = internalQuery({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }) => {
    const c = await ctx.db.get(contractId);
    if (!c) return null;
    return {
      _id: c._id,
      status: c.status,
      prompt: c.prompt,
      ir: c.ir ?? null,
      irHash: c.irHash ?? null,
      feeBps: c.feeBps,
      creatorId: c.creatorId,
      funderId: c.funderId ?? null,
      payeeId: c.payeeId ?? null,
      version: c.version,
    };
  },
});
