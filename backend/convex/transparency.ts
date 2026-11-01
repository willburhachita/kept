/**
 * Transparency log. Every 10 minutes all new journal entries (across every
 * stream) are sealed into an RFC 6962 Merkle tree whose signed root chains to
 * the previous checkpoint. Editing any past entry would change a published
 * root, so history cannot be rewritten silently, not even by the operator.
 */
import {
  GENESIS_HASH,
  checkpointHash,
  inclusionProof,
  merkleRoot,
  signCheckpoint,
  verifyCheckpointSignature,
  verifyInclusion,
} from "@kept/core";
import { v } from "convex/values";
import { internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { signingKey } from "./lib/env";

const BATCH = 256;

export const checkpoint = internalMutation({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.db
      .query("journal")
      .withIndex("by_checkpoint", (q) => q.eq("checkpoint", null))
      .take(BATCH);
    if (pending.length === 0) return null;
    const prev = await ctx.db.query("checkpoints").withIndex("by_seq").order("desc").first();
    const core = {
      seq: (prev?.seq ?? 0) + 1,
      size: pending.length,
      root: merkleRoot(pending.map((e) => e.hash)),
      prevHash: prev?.hash ?? GENESIS_HASH,
      at: Date.now(),
    };
    const hash = checkpointHash(core);
    const key = signingKey();
    await ctx.db.insert("checkpoints", { ...core, hash, sig: signCheckpoint(hash, key), keyId: key.keyId });
    for (let i = 0; i < pending.length; i++) await ctx.db.patch(pending[i]._id, { checkpoint: core.seq, leafIndex: i });
    return { seq: core.seq, size: core.size, root: core.root };
  },
});

async function listFlow(ctx: QueryCtx, limit: number) {
  const rows = await ctx.db
    .query("checkpoints")
    .withIndex("by_seq")
    .order("desc")
    .take(Math.min(Math.max(limit, 1), 100));
  const key = signingKey();
  const pending = await ctx.db
    .query("journal")
    .withIndex("by_checkpoint", (q) => q.eq("checkpoint", null))
    .take(1001);
  // rows are newest first: each row must link to the next (older) one
  const checkpoints = rows.map((r, i) => ({
    seq: r.seq,
    size: r.size,
    root: r.root,
    prevHash: r.prevHash,
    hash: r.hash,
    sig: r.sig,
    keyId: r.keyId,
    at: r.at,
    signatureValid: r.keyId === key.keyId && verifyCheckpointSignature(r.hash, r.sig, key.publicKeyHex),
    hashValid: checkpointHash(r) === r.hash,
    linksToPrevious: i + 1 < rows.length ? r.prevHash === rows[i + 1].hash : r.seq === 1 ? r.prevHash === GENESIS_HASH : null,
  }));
  return {
    publicKey: key.publicKeyHex,
    keyId: key.keyId,
    latestSeq: rows[0]?.seq ?? 0,
    latestAgeMs: rows[0] ? Date.now() - rows[0].at : null,
    entriesInListed: rows.reduce((s, r) => s + r.size, 0),
    pendingEntries: pending.length > 1000 ? "1000+" : pending.length,
    checkpoints,
  };
}

async function proofFlow(ctx: QueryCtx, entryHash: string) {
  if (!/^[0-9a-f]{64}$/.test(entryHash)) return null;
  const entry = await ctx.db
    .query("journal")
    .withIndex("by_hash", (q) => q.eq("hash", entryHash))
    .first();
  if (!entry) return null;
  const base = { entry: { stream: entry.stream, seq: entry.seq, hash: entry.hash, type: entry.type, at: entry.at } };
  if (entry.checkpoint === null || entry.leafIndex === undefined) return { ...base, status: "pending" as const };
  const cp = await ctx.db
    .query("checkpoints")
    .withIndex("by_seq", (q) => q.eq("seq", entry.checkpoint as number))
    .unique();
  if (!cp) return { ...base, status: "pending" as const };
  const leaves = await ctx.db
    .query("journal")
    .withIndex("by_checkpoint", (q) => q.eq("checkpoint", cp.seq))
    .take(BATCH + 1);
  const hashes = leaves.sort((a, b) => (a.leafIndex ?? 0) - (b.leafIndex ?? 0)).map((e) => e.hash);
  const proof = inclusionProof(hashes, entry.leafIndex);
  const key = signingKey();
  return {
    ...base,
    status: "sealed" as const,
    leafIndex: entry.leafIndex,
    treeSize: hashes.length,
    proof,
    checkpoint: { seq: cp.seq, size: cp.size, root: cp.root, prevHash: cp.prevHash, hash: cp.hash, sig: cp.sig, keyId: cp.keyId, at: cp.at },
    publicKey: key.publicKeyHex,
    verified: {
      inclusion: verifyInclusion(entry.hash, entry.leafIndex, hashes.length, proof, cp.root),
      checkpointHash: checkpointHash(cp) === cp.hash,
      checkpointSignature: cp.keyId === key.keyId && verifyCheckpointSignature(cp.hash, cp.sig, key.publicKeyHex),
    },
  };
}

export const listCheckpoints = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => listFlow(ctx, limit ?? 20),
});

export const proofFor = internalQuery({
  args: { entryHash: v.string() },
  handler: async (ctx, { entryHash }) => proofFlow(ctx, entryHash.toLowerCase()),
});

/** Public: recent signed checkpoints with chain and signature checks. */
export const checkpoints = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => listFlow(ctx, limit ?? 20),
});

/** Public: inclusion proof for one journal entry hash, verified server-side (and verifiable client-side with @kept/core). */
export const verifyEntry = query({
  args: { entryHash: v.string() },
  handler: async (ctx, { entryHash }) => proofFlow(ctx, entryHash.toLowerCase()),
});
