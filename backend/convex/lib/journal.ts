/**
 * The journal: one append-only, hash-chained, signed log per stream
 * (a contract id or a mandate id). Every state change that matters is
 * written here in the same transaction as the change itself.
 */
import { GENESIS_HASH, sealJournalEntry } from "@kept/core";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { enqueueOutboundWebhooks } from "../outbound";
import { signingKey } from "./env";

export type Actor = `user:${string}` | `agent:${string}` | "system" | "paypal" | `arbiter:${string}`;

export const actorUser = (id: Id<"users">): Actor => `user:${id}`;

export async function appendJournal(
  ctx: MutationCtx,
  stream: string,
  actor: Actor,
  type: string,
  data: Record<string, unknown> = {},
): Promise<Id<"journal">> {
  const head = await ctx.db
    .query("journalHeads")
    .withIndex("by_stream", (q) => q.eq("stream", stream))
    .unique();
  const seq = (head?.seq ?? 0) + 1;
  const prevHash = head?.hash ?? GENESIS_HASH;
  // Normalize to exactly what will be stored, so the hash covers the stored bytes.
  const clean = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  const sealed = sealJournalEntry({ stream, seq, at: Date.now(), actor, type, data: clean, prevHash }, signingKey());
  const id = await ctx.db.insert("journal", { ...sealed, checkpoint: null });
  if (head) await ctx.db.patch(head._id, { seq, hash: sealed.hash });
  else await ctx.db.insert("journalHeads", { stream, seq, hash: sealed.hash });
  await enqueueOutboundWebhooks(ctx, { journalId: id, stream, type });
  return id;
}
