/**
 * Enqueue side effects (PayPal calls) in the same transaction as the state
 * change that requires them. The effect processor (effects.ts) executes them
 * strictly in order per stream, with idempotency keys and retries.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type EffectKind = Doc<"effects">["kind"];
export type StreamKind = Doc<"effects">["streamKind"];

/** capture_authorization: capture `amountCents` (= releaseCents + feeCents) then pay `releaseCents` out. */
export interface CaptureParams {
  amountCents: number;
  releaseCents: number;
  feeCents: number;
  purpose: "release" | "spend";
  /** Required for purpose "spend" (merchant). For "release" the payee's locked payout email is used. */
  receiverEmail?: string;
  spendId?: string;
  note?: string;
}

export interface PayoutParams {
  amountCents: number;
  receiverEmail: string;
  purpose: "release" | "spend";
  spendId?: string;
  note?: string;
}

export interface RefundParams {
  captureId: string;
  amountCents: number;
  note?: string;
}

export type EffectParams =
  | { kind: "capture_authorization"; params: CaptureParams }
  | { kind: "payout"; params: PayoutParams }
  | { kind: "refund_capture"; params: RefundParams }
  | { kind: "void_authorization"; params: Record<string, never> }
  | { kind: "protective_capture"; params: Record<string, never> }
  | { kind: "reauthorize"; params: Record<string, never> };

export async function enqueueEffect(
  ctx: MutationCtx,
  e: { stream: string; streamKind: StreamKind; ref?: string } & EffectParams,
): Promise<Id<"effects">> {
  const last = await ctx.db
    .query("effects")
    .withIndex("by_stream_seq", (q) => q.eq("stream", e.stream))
    .order("desc")
    .first();
  const now = Date.now();
  const id = await ctx.db.insert("effects", {
    stream: e.stream,
    streamKind: e.streamKind,
    seq: (last?.seq ?? 0) + 1,
    kind: e.kind,
    params: JSON.parse(JSON.stringify(e.params)),
    status: "pending",
    attempts: 0,
    nextAttemptAt: now,
    ref: e.ref,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.effects.process, { stream: e.stream });
  return id;
}

/** Any effect for this stream not yet finished? */
export async function hasOpenEffects(ctx: MutationCtx, stream: string): Promise<boolean> {
  const open = await ctx.db
    .query("effects")
    .withIndex("by_stream_seq", (q) => q.eq("stream", stream))
    .filter((q) => q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "in_flight")))
    .first();
  return open !== null;
}
