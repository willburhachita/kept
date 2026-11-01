/**
 * Token-bucket rate limiting inside mutations. A rejected call throws, which
 * rolls back the transaction, so rejected calls consume nothing.
 */
import type { MutationCtx } from "../_generated/server";
import { fail } from "./errors";

export interface Bucket {
  capacity: number;
  refillPerHour: number;
}

export const LIMITS = {
  compile: { capacity: 10, refillPerHour: 20 },
  createContract: { capacity: 20, refillPerHour: 40 },
  evidenceUpload: { capacity: 20, refillPerHour: 60 },
  inviteAccept: { capacity: 10, refillPerHour: 30 },
  agentSpend: { capacity: 30, refillPerHour: 600 },
  apiRequest: { capacity: 120, refillPerHour: 3600 },
  verify: { capacity: 60, refillPerHour: 600 },
  secretIssue: { capacity: 10, refillPerHour: 20 },
} satisfies Record<string, Bucket>;

export async function rateLimit(ctx: MutationCtx, key: string, bucket: Bucket, cost = 1): Promise<void> {
  const now = Date.now();
  const doc = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const refill = (elapsedMs: number) => (elapsedMs * bucket.refillPerHour) / 3_600_000;
  const available = doc ? Math.min(bucket.capacity, doc.tokens + refill(now - doc.updatedAt)) : bucket.capacity;
  if (available < cost) {
    const retryAfterMs = Math.ceil(((cost - available) / bucket.refillPerHour) * 3_600_000);
    fail("RATE_LIMITED", "Too many requests. Try again shortly.", { retryAfterMs });
  }
  if (doc) await ctx.db.patch(doc._id, { tokens: available - cost, updatedAt: now });
  else await ctx.db.insert("rateLimits", { key, tokens: available - cost, updatedAt: now });
}
