import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { assertEmail, getProfile, requireProfile, requireUserId } from "./lib/authz";
import { getAuthUserId } from "@convex-dev/auth/server";
import { fail } from "./lib/errors";

/** The signed-in user, or null. */
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const p = await getProfile(ctx, userId);
    if (!p) return null;
    return { userId, email: p.email, displayName: p.displayName, payoutEmail: p.payoutEmail ?? null, role: p.role, createdAt: p.createdAt };
  },
});

/** Update display name and the PayPal email used for payouts. */
export const updateProfile = mutation({
  args: { displayName: v.optional(v.string()), payoutEmail: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, a) => {
    const userId = await requireUserId(ctx);
    const p = await requireProfile(ctx, userId);
    const patch: { displayName?: string; payoutEmail?: string | undefined } = {};
    if (a.displayName !== undefined) {
      const name = a.displayName.trim();
      if (!name || name.length > 80) fail("INVALID_ARGUMENT", "Display name must be 1-80 characters.");
      patch.displayName = name;
    }
    if (a.payoutEmail !== undefined) patch.payoutEmail = a.payoutEmail === null ? undefined : assertEmail(a.payoutEmail, "payoutEmail");
    await ctx.db.patch(p._id, patch);
  },
});

/**
 * Grant a role. Internal only: run from the dashboard or CLI, e.g.
 *   npx convex run users:grantRole '{"email":"you@example.com","role":"arbiter"}'
 */
export const grantRole = internalMutation({
  args: { email: v.string(), role: v.union(v.literal("user"), v.literal("arbiter"), v.literal("admin")) },
  handler: async (ctx, { email, role }) => {
    const p = await ctx.db
      .query("profiles")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .unique();
    if (!p) fail("NOT_FOUND", "No user with that email.");
    await ctx.db.patch(p._id, { role });
    return { userId: p.userId, role };
  },
});
