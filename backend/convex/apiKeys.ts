/**
 * Developer API keys for the REST API (Authorization: Bearer sk_test_...).
 * Only the SHA-256 of a key is stored; the key itself is shown once.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getProfile, requireUserId } from "./lib/authz";
import { fail } from "./lib/errors";
import { LIMITS, rateLimit } from "./lib/rateLimit";
import { issueSecret } from "./lib/secrets";

const MAX_KEYS = 10;

export const _insert = internalMutation({
  args: { userId: v.id("users"), label: v.string(), keyHash: v.string(), prefix: v.string() },
  handler: async (ctx, a) => {
    await rateLimit(ctx, `apikey:${a.userId}`, LIMITS.secretIssue);
    const keys = await ctx.db.query("apiKeys").withIndex("by_user", (q) => q.eq("userId", a.userId)).take(100);
    if (keys.filter((k) => !k.revokedAt).length >= MAX_KEYS) fail("INVALID_STATE", `At most ${MAX_KEYS} active API keys.`);
    return await ctx.db.insert("apiKeys", { userId: a.userId, keyHash: a.keyHash, prefix: a.prefix, label: a.label.trim().slice(0, 80) || "default", createdAt: Date.now() });
  },
});

/** Create an API key. Returned once; store it in your server's secrets. */
export const create = action({
  args: { label: v.string() },
  handler: async (ctx, { label }): Promise<{ keyId: Id<"apiKeys">; key: string; prefix: string }> => {
    const userId = await requireUserId(ctx);
    const secret = issueSecret("sk");
    const keyId: Id<"apiKeys"> = await ctx.runMutation(internal.apiKeys._insert, { userId, label, keyHash: secret.hash, prefix: secret.prefix });
    return { keyId, key: secret.token, prefix: secret.prefix };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const keys = await ctx.db.query("apiKeys").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(50);
    return keys.map((k) => ({ _id: k._id, prefix: k.prefix, label: k.label, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt ?? null, revoked: Boolean(k.revokedAt) }));
  },
});

export const revoke = mutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, { keyId }) => {
    const userId = await requireUserId(ctx);
    const k = await ctx.db.get(keyId);
    if (!k || k.userId !== userId) fail("NOT_FOUND", "API key not found.");
    if (!k.revokedAt) await ctx.db.patch(k._id, { revokedAt: Date.now() });
  },
});

export const authenticate = internalQuery({
  args: { keyHash: v.string() },
  handler: async (ctx, { keyHash }) => {
    const k = await ctx.db.query("apiKeys").withIndex("by_hash", (q) => q.eq("keyHash", keyHash)).unique();
    return k && !k.revokedAt ? { userId: k.userId, keyId: k._id } : null;
  },
});

/** Rate limit per key and record usage (at most one write per minute). */
export const _touch = internalMutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, { keyId }) => {
    await rateLimit(ctx, `api:${keyId}`, LIMITS.apiRequest);
    const k = await ctx.db.get(keyId);
    if (k && Date.now() - (k.lastUsedAt ?? 0) > 60_000) await ctx.db.patch(k._id, { lastUsedAt: Date.now() });
  },
});

export const me = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const p = await getProfile(ctx, userId);
    if (!p) fail("NOT_FOUND", "User not found.");
    return { userId, email: p.email, displayName: p.displayName, payoutEmail: p.payoutEmail ?? null, role: p.role };
  },
});
