/**
 * Verification: runs the exhaustive model checker on a contract and stores
 * the report content-addressed by (irHash, feeBps, engineVersion).
 * Only server code writes results, so "verified" can be trusted at funding.
 */
import { ENGINE_VERSION, sha256Hex, canonicalJson, verify, verifyContract, type VerificationReport } from "@kept/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { readableContract, requireUserId } from "./lib/authz";
import { fail } from "./lib/errors";
import { appendJournal } from "./lib/journal";
import { notify } from "./lib/notify";
import { LIMITS, rateLimit } from "./lib/rateLimit";

export const _load = internalQuery({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }) => {
    const c = await ctx.db.get(contractId);
    return c ? { ir: c.ir ?? null, irHash: c.irHash ?? null, feeBps: c.feeBps, status: c.status } : null;
  },
});

export const _store = internalMutation({
  args: { contractId: v.id("contracts"), irHash: v.string(), feeBps: v.number(), report: v.any() },
  handler: async (ctx, { contractId, irHash, feeBps, report }) => {
    const r = report as VerificationReport;
    const existing = await ctx.db
      .query("verifications")
      .withIndex("by_key", (q) => q.eq("irHash", irHash).eq("feeBps", feeBps).eq("engineVersion", ENGINE_VERSION))
      .first();
    const verificationId =
      existing?._id ??
      (await ctx.db.insert("verifications", { irHash, feeBps, engineVersion: ENGINE_VERSION, ok: r.ok, summary: r.summary, report: r, createdAt: Date.now() }));
    const c = await ctx.db.get(contractId);
    // Ignore stale results: the terms may have changed while we were checking.
    if (!c || c.irHash !== irHash || c.feeBps !== feeBps) return { stale: true };
    if (c.status !== "verifying" && c.status !== "compiling") return { stale: true };
    await ctx.db.patch(c._id, {
      verification: { irHash, ok: r.ok, summary: r.summary, verificationId },
      status: r.ok ? "review" : "needs_attention",
      updatedAt: Date.now(),
    });
    await appendJournal(ctx, c._id, "system", r.ok ? "terms.verified" : "terms.rejected", {
      irHash,
      engineVersion: ENGINE_VERSION,
      reportSha256: sha256Hex(canonicalJson(r)),
      summary: r.summary,
      states: r.stats.states,
      violated: r.properties.filter((p) => p.status === "violated").map((p) => p.id),
    });
    const n = {
      kind: r.ok ? "terms.verified" : "terms.rejected",
      title: r.ok ? "Terms verified" : "Verification found a problem",
      body: r.summary,
      stream: c._id,
    };
    await notify(ctx, c.funderId, n);
    await notify(ctx, c.payeeId, n);
    return { stale: false, ok: r.ok };
  },
});

/** Verify the contract's current terms. Scheduled whenever terms change. */
export const run = internalAction({
  args: { contractId: v.id("contracts"), irHash: v.string() },
  handler: async (ctx, { contractId, irHash }) => {
    const snap = await ctx.runQuery(internal.verification._load, { contractId });
    if (!snap || !snap.ir || snap.irHash !== irHash) return;
    const report = verify(snap.ir, { feeBps: snap.feeBps });
    await ctx.runMutation(internal.verification._store, { contractId, irHash, feeBps: snap.feeBps, report });
  },
});

export const _limit = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => rateLimit(ctx, key, LIMITS.verify),
});

/** Stateless check of any contract JSON (also available offline via @kept/core). */
export const verifyDraft = action({
  args: { ir: v.any(), feeBps: v.optional(v.number()) },
  handler: async (ctx, { ir, feeBps }) => {
    const userId = await requireUserId(ctx);
    await ctx.runMutation(internal.verification._limit, { key: `verify:${userId}` });
    if (feeBps !== undefined && (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 2000)) fail("INVALID_ARGUMENT", "feeBps must be 0-2000.");
    const res = verifyContract(ir, { feeBps: feeBps ?? 0, maxStates: 50_000 });
    return res.valid ? { valid: true as const, report: res.report, warnings: res.issues } : { valid: false as const, issues: res.issues };
  },
});

/** Full report for the contract's current terms. */
export const report = query({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }) => {
    const userId = await requireUserId(ctx);
    const { contract: c } = await readableContract(ctx, contractId, userId);
    if (!c.verification) return null;
    const row = await ctx.db.get(c.verification.verificationId);
    return row ? { ok: row.ok, summary: row.summary, report: row.report as VerificationReport, current: row.irHash === c.irHash } : null;
  },
});
