import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export interface NotificationInput {
  kind: string;
  title: string;
  body: string;
  stream?: string;
}

export async function notify(ctx: MutationCtx, userId: Id<"users"> | undefined | null, n: NotificationInput): Promise<void> {
  if (!userId) return;
  await ctx.db.insert("notifications", { userId, ...n, read: false, at: Date.now() });
}

/** Notify every arbiter/admin (used when a human decision is required). */
export async function notifyStaff(ctx: MutationCtx, n: NotificationInput): Promise<void> {
  for (const role of ["arbiter", "admin"] as const) {
    const staff = await ctx.db
      .query("profiles")
      .withIndex("by_role", (q) => q.eq("role", role))
      .take(50);
    for (const p of staff) await notify(ctx, p.userId, n);
  }
}
