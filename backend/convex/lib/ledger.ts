import type { MutationCtx } from "../_generated/server";

/** Accounts used in ledger entries. */
export type Account =
  | "funder"
  | "hold"
  | "fee_reserve"
  | "payee"
  | "platform"
  | `merchant:${string}`
  | "paypal:captured"
  | "paypal:paid_out"
  | "paypal:voided"
  | "paypal:refunded";

export interface Posting {
  kind: string;
  cents: number;
  from: Account;
  to: Account;
  memo?: string;
  ref?: string;
}

export async function postLedger(ctx: MutationCtx, stream: string, postings: Posting[]): Promise<void> {
  if (postings.length === 0) return;
  const last = await ctx.db
    .query("ledgerEntries")
    .withIndex("by_stream", (q) => q.eq("stream", stream))
    .order("desc")
    .first();
  let seq = last?.seq ?? 0;
  const at = Date.now();
  for (const p of postings) {
    if (!Number.isSafeInteger(p.cents) || p.cents <= 0) continue;
    seq += 1;
    await ctx.db.insert("ledgerEntries", { stream, seq, at, ...p });
  }
}
