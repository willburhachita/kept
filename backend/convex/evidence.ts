/**
 * Evidence: submissions, the AI examiner, the challenge window, funder
 * review, disputes and arbitration. Every final decision feeds the contract
 * state machine (accept/reject) in the same transaction, so the money rule it
 * triggers commits together with the decision.
 */
import { EVIDENCE_VERDICT_SCHEMA, SLA, formatHours, sortedDeadlines } from "@kept/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { aiConfigured, callStructured, type UserBlock } from "./ai/claude";
import { buildExaminerContent, EXAMINER_SYSTEM, textSubmission } from "./ai/examiner";
import { applyEvent } from "./engine";
import { loadContract, readableContract, requireRole, requireUserId } from "./lib/authz";
import { fail } from "./lib/errors";
import { actorUser, appendJournal, type Actor } from "./lib/journal";
import { notify, notifyStaff } from "./lib/notify";
import { LIMITS, rateLimit } from "./lib/rateLimit";

const HOUR = 3_600_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT = 20_000;
const MAX_URL = 2_000;
const MAX_REASON = 1_000;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
const TEXT_TYPES = ["image/svg+xml", "text/plain", "text/markdown", "application/json"];
const FILE_TYPES = new Set<string>([...IMAGE_TYPES, ...TEXT_TYPES, "application/pdf"]);

type EvidenceDoc = Doc<"evidence">;
type Status = EvidenceDoc["status"];

export const STATUS_LABEL: Record<Status, string> = {
  checking: "AI examiner is checking it",
  challenge_window: "Passed the AI check; the funder can still object",
  awaiting_funder: "Waiting for the funder's review",
  funder_rejected: "Rejected by the funder; the payee can dispute",
  in_arbitration: "With an arbiter",
  accepted: "Accepted",
  rejected: "Rejected",
};

export interface Verdict {
  criteria: { criterion: string; met: boolean; confidence: number; reason: string }[];
  overall: "pass" | "fail" | "uncertain";
  confidence: number;
  summary: string;
  suspectedManipulation: boolean;
  manipulationNotes: string;
  model?: string;
  forcedUncertainReason?: string;
}

const clamp01 = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Align the model's answer with the slot's criteria and enforce the rules in code. */
function normalizeVerdict(raw: Verdict, criteria: string[], model: string, forceUncertain?: string): Verdict {
  const rows = criteria.map((criterion, i) => {
    const r = raw.criteria?.[i];
    return { criterion, met: r?.met === true, confidence: clamp01(r?.confidence), reason: String(r?.reason ?? "No assessment returned.").slice(0, 600) };
  });
  const allMet = rows.every((r) => r.met);
  let overall: Verdict["overall"] = raw.overall === "pass" || raw.overall === "fail" ? raw.overall : "uncertain";
  if (overall === "pass" && (!allMet || raw.suspectedManipulation)) overall = "uncertain";
  if (forceUncertain && overall === "pass") overall = "uncertain";
  return {
    criteria: rows,
    overall,
    confidence: clamp01(raw.confidence),
    summary: String(raw.summary ?? "").slice(0, 800),
    suspectedManipulation: raw.suspectedManipulation === true,
    manipulationNotes: String(raw.manipulationNotes ?? "").slice(0, 600),
    model,
    ...(forceUncertain ? { forcedUncertainReason: forceUncertain } : {}),
  };
}

function uncertainVerdict(criteria: string[], reason: string): Verdict {
  return {
    criteria: criteria.map((criterion) => ({ criterion, met: false, confidence: 0, reason })),
    overall: "uncertain",
    confidence: 0,
    summary: reason,
    suspectedManipulation: false,
    manipulationNotes: "",
    forcedUncertainReason: reason,
  };
}

function passesAutoAccept(v: Verdict, threshold: number): boolean {
  return v.overall === "pass" && v.confidence >= threshold && v.criteria.every((c) => c.met) && !v.suspectedManipulation;
}

/**
 * Final decision. Feeds the state machine when the contract is still active;
 * if the contract has already settled the decision is recorded as moot.
 * Returns false (and changes nothing) when the contract is frozen and the
 * caller is a timer, so the sweep retries after an arbiter resumes it.
 */
async function decide(ctx: MutationCtx, ev: EvidenceDoc, outcome: "accepted" | "rejected", actor: Actor, reason: string, isTimer = false): Promise<boolean> {
  const c = await loadContract(ctx, ev.contractId);
  if (c.status === "frozen") {
    if (isTimer) return false;
    fail("INVALID_STATE", "The contract is frozen; an arbiter must resume it first.");
  }
  const now = Date.now();
  await ctx.db.patch(ev._id, { status: outcome, decision: { by: actor, outcome, reason: reason.slice(0, MAX_REASON), at: now } });
  const live = c.status === "active";
  await appendJournal(ctx, c._id, actor, `evidence.${outcome}`, { evidenceId: ev._id, slotId: ev.slotId, reason: reason.slice(0, 300), moot: !live });
  if (live) await applyEvent(ctx, c._id, { type: outcome === "accepted" ? "accept" : "reject", evidence: ev.slotId }, actor);
  const label = c.ir?.evidence.find((s) => s.id === ev.slotId)?.label ?? ev.slotId;
  const n = { kind: `evidence.${outcome}`, title: `“${label}” ${outcome}`, body: reason.slice(0, 200), stream: c._id };
  await notify(ctx, c.funderId, n);
  await notify(ctx, c.payeeId, n);
  return true;
}

async function toArbitration(ctx: MutationCtx, ev: EvidenceDoc, patch: Partial<EvidenceDoc>, actor: Actor, why: string) {
  const due = Date.now() + SLA.arbiterHours * HOUR;
  await ctx.db.patch(ev._id, { ...patch, status: "in_arbitration", arbitrationDueAt: due });
  await appendJournal(ctx, ev.contractId, actor, "evidence.arbitration", { evidenceId: ev._id, slotId: ev.slotId, why, dueAt: due });
  await notifyStaff(ctx, { kind: "arbitration.needed", title: "Evidence needs an arbiter", body: why.slice(0, 200), stream: ev.contractId });
}

async function loadEvidence(ctx: QueryCtx | MutationCtx, id: Id<"evidence">): Promise<EvidenceDoc> {
  const ev = await ctx.db.get(id);
  if (!ev) fail("NOT_FOUND", "Evidence not found.");
  return ev;
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

async function uploadUrlFlow(ctx: MutationCtx, userId: Id<"users">, contractId: Id<"contracts">) {
  const c = await loadContract(ctx, contractId);
  requireRole(c, userId, ["payee"]);
  if (c.status !== "active") fail("INVALID_STATE", `Contract is ${c.status}, not active.`);
  await rateLimit(ctx, `upload:${userId}`, LIMITS.evidenceUpload);
  return { uploadUrl: await ctx.storage.generateUploadUrl(), maxBytes: MAX_FILE_BYTES, allowedTypes: [...FILE_TYPES] };
}

export const generateUploadUrl = mutation({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }) => uploadUrlFlow(ctx, await requireUserId(ctx), contractId),
});

export const generateUploadUrlAs = internalMutation({
  args: { userId: v.id("users"), contractId: v.id("contracts") },
  handler: async (ctx, { userId, contractId }) => uploadUrlFlow(ctx, userId, contractId),
});

const submitArgs = {
  contractId: v.id("contracts"),
  slotId: v.string(),
  storageId: v.optional(v.id("_storage")),
  fileName: v.optional(v.string()),
  text: v.optional(v.string()),
  url: v.optional(v.string()),
};

async function submitFlow(
  ctx: MutationCtx,
  userId: Id<"users">,
  a: { contractId: Id<"contracts">; slotId: string; storageId?: Id<"_storage">; fileName?: string; text?: string; url?: string },
) {
  const c = await loadContract(ctx, a.contractId);
  requireRole(c, userId, ["payee"]);
  if (c.status !== "active" || !c.ir || !c.machine) fail("INVALID_STATE", `Contract is ${c.status}, not active.`);
  const slot = c.ir.evidence.find((s) => s.id === a.slotId);
  if (!slot) fail("INVALID_ARGUMENT", `Unknown evidence slot "${a.slotId}".`);
  await rateLimit(ctx, `evidence:${userId}`, LIMITS.evidenceUpload);

  let fields: Partial<EvidenceDoc> = {};
  if (slot.kind === "file") {
    if (!a.storageId) fail("INVALID_ARGUMENT", "Upload the file first, then submit its storageId.");
    const meta = await ctx.db.system.get(a.storageId);
    if (!meta) fail("INVALID_ARGUMENT", "Uploaded file not found.");
    const contentType = (meta.contentType ?? "").split(";")[0].trim().toLowerCase();
    if (!FILE_TYPES.has(contentType)) fail("INVALID_ARGUMENT", `File type ${contentType || "unknown"} is not accepted.`);
    if (meta.size > MAX_FILE_BYTES) fail("INVALID_ARGUMENT", "Files must be 10 MB or smaller.");
    fields = { storageId: a.storageId, fileName: a.fileName?.trim().slice(0, 200) || undefined, contentType, size: meta.size, sha256: meta.sha256 };
  } else if (slot.kind === "text") {
    const text = a.text?.trim() ?? "";
    if (!text || text.length > MAX_TEXT) fail("INVALID_ARGUMENT", `Text must be 1-${MAX_TEXT} characters.`);
    fields = { text };
  } else {
    let url: URL;
    try {
      url = new URL((a.url ?? "").trim());
    } catch {
      fail("INVALID_ARGUMENT", "Submit a valid https link.");
    }
    if (url.protocol !== "https:" || url.toString().length > MAX_URL) fail("INVALID_ARGUMENT", "Links must be https and at most 2000 characters.");
    fields = { url: url.toString() };
  }

  const beforeDeadlines = sortedDeadlines(c.ir)
    .map((d) => d.id)
    .filter((id) => !c.machine!.passed.includes(id));
  await applyEvent(ctx, c._id, { type: "submit", evidence: slot.id }, actorUser(userId)); // enforces window + single submission

  const now = Date.now();
  const ai = aiConfigured();
  const due = now + SLA.funderReviewHours * HOUR;
  const evidenceId = await ctx.db.insert("evidence", {
    contractId: c._id,
    slotId: slot.id,
    submittedBy: userId,
    submittedAt: now,
    kind: slot.kind,
    ...fields,
    beforeDeadlines,
    status: ai ? "checking" : "awaiting_funder",
    ...(ai ? {} : { funderDecisionDueAt: due }),
  });
  if (ai) await ctx.scheduler.runAfter(0, internal.evidence.runExaminer, { evidenceId });
  else await ctx.scheduler.runAt(due, internal.evidence.escalate, { evidenceId });
  await appendJournal(ctx, c._id, actorUser(userId), "evidence.submitted", {
    evidenceId,
    slotId: slot.id,
    kind: slot.kind,
    sha256: fields.sha256 ?? null,
    size: fields.size ?? null,
    onTimeFor: beforeDeadlines,
  });
  await notify(ctx, c.funderId, {
    kind: "evidence.submitted",
    title: `“${slot.label}” submitted`,
    body: ai ? "The AI examiner is checking it now." : `Review it within ${formatHours(SLA.funderReviewHours)}.`,
    stream: c._id,
  });
  return { evidenceId, status: ai ? ("checking" as const) : ("awaiting_funder" as const) };
}

export const submit = mutation({
  args: submitArgs,
  handler: async (ctx, a) => submitFlow(ctx, await requireUserId(ctx), a),
});

export const submitAs = internalMutation({
  args: { userId: v.id("users"), ...submitArgs },
  handler: async (ctx, { userId, ...a }) => submitFlow(ctx, userId, a),
});

// ---------------------------------------------------------------------------
// AI examiner
// ---------------------------------------------------------------------------

export const _examinerJob = internalQuery({
  args: { evidenceId: v.id("evidence") },
  handler: async (ctx, { evidenceId }) => {
    const ev = await ctx.db.get(evidenceId);
    if (!ev || ev.status !== "checking") return null;
    const c = await ctx.db.get(ev.contractId);
    const slot = c?.ir?.evidence.find((s) => s.id === ev.slotId);
    if (!c || !slot) return null;
    return {
      contractTitle: c.ir!.title,
      slotLabel: slot.label,
      kind: slot.kind,
      criteria: slot.criteria,
      storageId: ev.storageId ?? null,
      contentType: ev.contentType ?? null,
      size: ev.size ?? null,
      text: ev.text ?? null,
      url: ev.url ?? null,
      fileName: ev.fileName ?? null,
    };
  },
});

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const runExaminer = internalAction({
  args: { evidenceId: v.id("evidence") },
  handler: async (ctx, { evidenceId }) => {
    const job = await ctx.runQuery(internal.evidence._examinerJob, { evidenceId });
    if (!job) return;
    let verdict: Verdict | null = null;
    let error: string | null = null;
    try {
      let blocks: UserBlock[] | null = null;
      let skip: string | null = null;
      let note: string | undefined;
      if (job.kind === "text") blocks = [textSubmission("payee submission", job.text ?? "")];
      else if (job.kind === "link") {
        note = "The examiner cannot open links. Judge only what the link text itself shows; the overall verdict must be uncertain.";
        blocks = [textSubmission("payee link", job.url ?? "")];
      } else if (job.storageId) {
        const blob = await ctx.storage.get(job.storageId);
        if (!blob) skip = "The uploaded file could not be read.";
        else {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const type = job.contentType ?? "";
          if ((IMAGE_TYPES as readonly string[]).includes(type)) {
            if (bytes.length > MAX_IMAGE_BYTES) skip = "The image is larger than the examiner's 5 MB limit; a person must review it.";
            else blocks = [{ type: "image", source: { type: "base64", media_type: type as (typeof IMAGE_TYPES)[number], data: toBase64(bytes) } }];
          } else if (type === "application/pdf") {
            blocks = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(bytes) } }];
          } else if (TEXT_TYPES.includes(type)) {
            blocks = [textSubmission(`payee file ${job.fileName ?? ""} (${type})`, new TextDecoder("utf-8", { fatal: false }).decode(bytes))];
          } else skip = `Files of type ${type || "unknown"} cannot be examined automatically.`;
        }
      } else skip = "No file was attached.";

      if (skip) verdict = uncertainVerdict(job.criteria, skip);
      else {
        const r = await callStructured<Verdict>({
          system: EXAMINER_SYSTEM,
          content: buildExaminerContent(job, blocks!, note),
          schema: EVIDENCE_VERDICT_SCHEMA,
          effort: "high",
          maxTokens: 8000,
        });
        verdict = normalizeVerdict(r.value, job.criteria, r.model, job.kind === "link" ? "The examiner cannot open links." : undefined);
      }
    } catch (e) {
      error = e instanceof ConvexError ? String((e.data as { message?: string })?.message ?? "AI error") : e instanceof Error ? e.message : String(e);
    }
    await ctx.runMutation(internal.evidence._recordVerdict, { evidenceId, verdict, error: error?.slice(0, 500) ?? null });
  },
});

export const _recordVerdict = internalMutation({
  args: { evidenceId: v.id("evidence"), verdict: v.union(v.any(), v.null()), error: v.union(v.string(), v.null()) },
  handler: async (ctx, { evidenceId, verdict, error }) => {
    const ev = await ctx.db.get(evidenceId);
    if (!ev || ev.status !== "checking") return;
    const c = await loadContract(ctx, ev.contractId);
    const slot = c.ir?.evidence.find((s) => s.id === ev.slotId);
    const now = Date.now();
    const v = verdict as Verdict | null;
    const pass = v !== null && slot !== undefined && passesAutoAccept(v, slot.autoAcceptConfidence);
    const ai = v ? { ...v, at: now } : undefined;
    if (pass && c.ir) {
      const endsAt = now + c.ir.challengeWindowHours * HOUR;
      await ctx.db.patch(ev._id, { status: "challenge_window", ai, aiError: undefined, challengeEndsAt: endsAt });
      await ctx.scheduler.runAt(endsAt, internal.evidence.closeChallengeWindow, { evidenceId });
      await notify(ctx, c.funderId, {
        kind: "evidence.passed",
        title: `AI passed “${slot!.label}”`,
        body: `It will be accepted automatically in ${formatHours(c.ir.challengeWindowHours)} unless you object.`,
        stream: c._id,
      });
    } else {
      const due = now + SLA.funderReviewHours * HOUR;
      await ctx.db.patch(ev._id, { status: "awaiting_funder", ai, aiError: error ?? undefined, funderDecisionDueAt: due });
      await ctx.scheduler.runAt(due, internal.evidence.escalate, { evidenceId });
      await notify(ctx, c.funderId, {
        kind: "evidence.review_needed",
        title: `Review “${slot?.label ?? ev.slotId}”`,
        body: v ? `AI verdict: ${v.overall}. ${v.summary}`.slice(0, 200) : "The AI examiner was unavailable; please review it yourself.",
        stream: c._id,
      });
    }
    await appendJournal(ctx, c._id, "system", "evidence.examined", {
      evidenceId,
      slotId: ev.slotId,
      overall: v?.overall ?? null,
      confidence: v?.confidence ?? null,
      suspectedManipulation: v?.suspectedManipulation ?? null,
      model: v?.model ?? null,
      route: pass ? "challenge_window" : "awaiting_funder",
      error: error ? error.slice(0, 200) : null,
    });
  },
});

// ---------------------------------------------------------------------------
// Human decisions
// ---------------------------------------------------------------------------

async function participantEvidence(ctx: MutationCtx, userId: Id<"users">, evidenceId: Id<"evidence">, role: "funder" | "payee") {
  const ev = await loadEvidence(ctx, evidenceId);
  const c = await loadContract(ctx, ev.contractId);
  requireRole(c, userId, [role]);
  return { ev, c };
}

function reasonOf(reason: string | undefined, required: boolean): string {
  const r = (reason ?? "").trim();
  if (required && !r) fail("INVALID_ARGUMENT", "Give a reason.");
  if (r.length > MAX_REASON) fail("INVALID_ARGUMENT", `Reason must be at most ${MAX_REASON} characters.`);
  return r;
}

async function acceptFlow(ctx: MutationCtx, userId: Id<"users">, evidenceId: Id<"evidence">) {
  const { ev } = await participantEvidence(ctx, userId, evidenceId, "funder");
  if (ev.status === "accepted" || ev.status === "rejected") fail("INVALID_STATE", `Evidence is already ${ev.status}.`);
  await decide(ctx, ev, "accepted", actorUser(userId), "Accepted by the funder.");
  return { status: "accepted" as const };
}

async function rejectFlow(ctx: MutationCtx, userId: Id<"users">, evidenceId: Id<"evidence">, reason: string) {
  const { ev, c } = await participantEvidence(ctx, userId, evidenceId, "funder");
  if (ev.status !== "awaiting_funder" && ev.status !== "checking") fail("INVALID_STATE", "Only evidence waiting for your review can be rejected; use challenge during a challenge window.");
  const why = reasonOf(reason, true);
  const endsAt = Date.now() + SLA.disputeWindowHours * HOUR;
  await ctx.db.patch(ev._id, { status: "funder_rejected", disputeEndsAt: endsAt, challenge: { by: userId, reason: why, at: Date.now() } });
  await ctx.scheduler.runAt(endsAt, internal.evidence.finalizeRejection, { evidenceId });
  await appendJournal(ctx, c._id, actorUser(userId), "evidence.funder_rejected", { evidenceId, slotId: ev.slotId, reason: why.slice(0, 300), disputeEndsAt: endsAt });
  await notify(ctx, c.payeeId, {
    kind: "evidence.funder_rejected",
    title: "Your submission was rejected",
    body: `${why.slice(0, 150)} You can dispute within ${formatHours(SLA.disputeWindowHours)}.`,
    stream: c._id,
  });
  return { status: "funder_rejected" as const, disputeEndsAt: endsAt };
}

async function challengeFlow(ctx: MutationCtx, userId: Id<"users">, evidenceId: Id<"evidence">, reason: string) {
  const { ev, c } = await participantEvidence(ctx, userId, evidenceId, "funder");
  if (ev.status !== "challenge_window") fail("INVALID_STATE", "There is no open challenge window for this evidence.");
  const why = reasonOf(reason, true);
  await toArbitration(ctx, ev, { challenge: { by: userId, reason: why, at: Date.now() } }, actorUser(userId), `Funder challenged: ${why}`);
  await notify(ctx, c.payeeId, { kind: "evidence.challenged", title: "The funder challenged your submission", body: why.slice(0, 200), stream: c._id });
  return { status: "in_arbitration" as const };
}

async function disputeFlow(ctx: MutationCtx, userId: Id<"users">, evidenceId: Id<"evidence">, reason: string) {
  const { ev, c } = await participantEvidence(ctx, userId, evidenceId, "payee");
  if (ev.status !== "funder_rejected") fail("INVALID_STATE", "Only a funder rejection can be disputed.");
  const why = reasonOf(reason, true);
  await toArbitration(ctx, ev, { dispute: { by: userId, reason: why, at: Date.now() } }, actorUser(userId), `Payee disputed the rejection: ${why}`);
  await notify(ctx, c.funderId, { kind: "evidence.disputed", title: "The payee disputed your rejection", body: why.slice(0, 200), stream: c._id });
  return { status: "in_arbitration" as const };
}

const idArg = { evidenceId: v.id("evidence") };
const reasonArgs = { evidenceId: v.id("evidence"), reason: v.string() };

export const accept = mutation({ args: idArg, handler: async (ctx, a) => acceptFlow(ctx, await requireUserId(ctx), a.evidenceId) });
export const reject = mutation({ args: reasonArgs, handler: async (ctx, a) => rejectFlow(ctx, await requireUserId(ctx), a.evidenceId, a.reason) });
export const challenge = mutation({ args: reasonArgs, handler: async (ctx, a) => challengeFlow(ctx, await requireUserId(ctx), a.evidenceId, a.reason) });
export const dispute = mutation({ args: reasonArgs, handler: async (ctx, a) => disputeFlow(ctx, await requireUserId(ctx), a.evidenceId, a.reason) });

export const acceptAs = internalMutation({ args: { userId: v.id("users"), ...idArg }, handler: async (ctx, a) => acceptFlow(ctx, a.userId, a.evidenceId) });
export const rejectAs = internalMutation({ args: { userId: v.id("users"), ...reasonArgs }, handler: async (ctx, a) => rejectFlow(ctx, a.userId, a.evidenceId, a.reason) });
export const challengeAs = internalMutation({ args: { userId: v.id("users"), ...reasonArgs }, handler: async (ctx, a) => challengeFlow(ctx, a.userId, a.evidenceId, a.reason) });
export const disputeAs = internalMutation({ args: { userId: v.id("users"), ...reasonArgs }, handler: async (ctx, a) => disputeFlow(ctx, a.userId, a.evidenceId, a.reason) });

/** Arbiter decision (called from arbiter.ts). */
export async function arbitrate(ctx: MutationCtx, evidenceId: Id<"evidence">, outcome: "accepted" | "rejected", actor: Actor, reason: string) {
  const ev = await loadEvidence(ctx, evidenceId);
  if (ev.status === "accepted" || ev.status === "rejected") fail("INVALID_STATE", `Evidence is already ${ev.status}.`);
  await decide(ctx, ev, outcome, actor, reasonOf(reason, true));
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

async function closeWindow(ctx: MutationCtx, ev: EvidenceDoc) {
  if (ev.status !== "challenge_window" || (ev.challengeEndsAt ?? Infinity) > Date.now()) return;
  await decide(ctx, ev, "accepted", "system", "The AI examiner passed it and the challenge window ended without an objection.", true);
}

async function escalateIfDue(ctx: MutationCtx, ev: EvidenceDoc) {
  if (ev.status !== "awaiting_funder" || (ev.funderDecisionDueAt ?? Infinity) > Date.now()) return;
  const c = await ctx.db.get(ev.contractId);
  if (!c || c.status === "frozen") return;
  await toArbitration(ctx, ev, {}, "system", `The funder did not review it within ${formatHours(SLA.funderReviewHours)}.`);
}

async function finalizeIfDue(ctx: MutationCtx, ev: EvidenceDoc) {
  if (ev.status !== "funder_rejected" || (ev.disputeEndsAt ?? Infinity) > Date.now()) return;
  await decide(ctx, ev, "rejected", "system", `The funder rejected it and the payee did not dispute within ${formatHours(SLA.disputeWindowHours)}.`, true);
}

export const closeChallengeWindow = internalMutation({
  args: idArg,
  handler: async (ctx, { evidenceId }) => {
    const ev = await ctx.db.get(evidenceId);
    if (ev) await closeWindow(ctx, ev);
  },
});

export const escalate = internalMutation({
  args: idArg,
  handler: async (ctx, { evidenceId }) => {
    const ev = await ctx.db.get(evidenceId);
    if (ev) await escalateIfDue(ctx, ev);
  },
});

export const finalizeRejection = internalMutation({
  args: idArg,
  handler: async (ctx, { evidenceId }) => {
    const ev = await ctx.db.get(evidenceId);
    if (ev) await finalizeIfDue(ctx, ev);
  },
});

/** Cron (every minute): advance anything whose scheduled timer was missed. */
export const sweepTimers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const byStatus = (s: Status) => ctx.db.query("evidence").withIndex("by_status", (q) => q.eq("status", s)).take(200);
    for (const ev of await byStatus("challenge_window")) if ((ev.challengeEndsAt ?? Infinity) <= now - 30_000) await closeWindow(ctx, ev);
    for (const ev of await byStatus("awaiting_funder")) if ((ev.funderDecisionDueAt ?? Infinity) <= now - 30_000) await escalateIfDue(ctx, ev);
    for (const ev of await byStatus("funder_rejected")) if ((ev.disputeEndsAt ?? Infinity) <= now - 30_000) await finalizeIfDue(ctx, ev);
  },
});

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

async function listFlow(ctx: QueryCtx, userId: Id<"users">, contractId: Id<"contracts">) {
  const { contract: c, role } = await readableContract(ctx, contractId, userId);
  const rows = await ctx.db
    .query("evidence")
    .withIndex("by_contract", (q) => q.eq("contractId", contractId))
    .order("desc")
    .take(100);
  const now = Date.now();
  return await Promise.all(
    rows.map(async (ev) => {
      const slot = c.ir?.evidence.find((s) => s.id === ev.slotId);
      const timer =
        ev.status === "challenge_window"
          ? { kind: "challenge_window", endsAt: ev.challengeEndsAt ?? null }
          : ev.status === "awaiting_funder"
            ? { kind: "funder_review", endsAt: ev.funderDecisionDueAt ?? null }
            : ev.status === "funder_rejected"
              ? { kind: "dispute_window", endsAt: ev.disputeEndsAt ?? null }
              : ev.status === "in_arbitration"
                ? { kind: "arbitration", endsAt: ev.arbitrationDueAt ?? null }
                : null;
      const final = ev.status === "accepted" || ev.status === "rejected";
      return {
        _id: ev._id,
        slotId: ev.slotId,
        slotLabel: slot?.label ?? ev.slotId,
        criteria: slot?.criteria ?? [],
        autoAcceptConfidence: slot?.autoAcceptConfidence ?? null,
        kind: ev.kind,
        status: ev.status,
        statusLabel: STATUS_LABEL[ev.status],
        submittedAt: ev.submittedAt,
        beforeDeadlines: ev.beforeDeadlines,
        onTime: ev.beforeDeadlines.length > 0,
        file: ev.storageId
          ? { url: await ctx.storage.getUrl(ev.storageId), fileName: ev.fileName ?? null, contentType: ev.contentType ?? null, size: ev.size ?? null, sha256: ev.sha256 ?? null }
          : null,
        text: ev.text ?? null,
        url: ev.url ?? null,
        ai: ev.ai ?? null,
        aiError: ev.aiError ?? null,
        timer: timer ? { ...timer, msRemaining: timer.endsAt ? Math.max(0, timer.endsAt - now) : null } : null,
        challengeEndsAt: ev.challengeEndsAt ?? null,
        funderDecisionDueAt: ev.funderDecisionDueAt ?? null,
        disputeEndsAt: ev.disputeEndsAt ?? null,
        arbitrationDueAt: ev.arbitrationDueAt ?? null,
        challenge: ev.challenge ?? null,
        dispute: ev.dispute ?? null,
        decision: ev.decision ?? null,
        canAccept: role === "funder" && !final && c.status === "active",
        canReject: role === "funder" && (ev.status === "awaiting_funder" || ev.status === "checking") && c.status === "active",
        canChallenge: role === "funder" && ev.status === "challenge_window" && c.status === "active",
        canDispute: role === "payee" && ev.status === "funder_rejected" && c.status === "active",
      };
    }),
  );
}

export const list = query({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }) => listFlow(ctx, await requireUserId(ctx), contractId),
});

export const listAs = internalQuery({
  args: { userId: v.id("users"), contractId: v.id("contracts") },
  handler: async (ctx, { userId, contractId }) => listFlow(ctx, userId, contractId),
});
