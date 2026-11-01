import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./lib/authz";

export const list = query({
  args: { limit: v.optional(v.number()), unreadOnly: v.optional(v.boolean()) },
  handler: async (ctx, { limit, unreadOnly }) => {
    const userId = await requireUserId(ctx);
    const n = Math.min(Math.max(limit ?? 50, 1), 200);
    const rows = unreadOnly
      ? await ctx.db.query("notifications").withIndex("by_user_read", (q) => q.eq("userId", userId).eq("read", false)).order("desc").take(n)
      : await ctx.db.query("notifications").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(n);
    return rows.map((r) => ({ _id: r._id, kind: r.kind, title: r.title, body: r.body, stream: r.stream ?? null, read: r.read, at: r.at }));
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db.query("notifications").withIndex("by_user_read", (q) => q.eq("userId", userId).eq("read", false)).take(100);
    return rows.length;
  },
});

export const markRead = mutation({
  args: { ids: v.optional(v.array(v.id("notifications"))) },
  handler: async (ctx, { ids }) => {
    const userId = await requireUserId(ctx);
    const rows = ids
      ? (await Promise.all(ids.map((id) => ctx.db.get(id)))).filter((r) => r !== null)
      : await ctx.db.query("notifications").withIndex("by_user_read", (q) => q.eq("userId", userId).eq("read", false)).take(200);
    for (const r of rows) if (r.userId === userId && !r.read) await ctx.db.patch(r._id, { read: true });
  },
});
