/**
 * Outbound webhooks for developers integrating Kept into their own apps.
 * Every journal entry on a stream a user participates in is delivered to
 * that user's endpoints, signed with the Standard Webhooks scheme:
 *   webhook-id, webhook-timestamp, webhook-signature: v1,<base64 HMAC-SHA256>
 * over `${id}.${timestamp}.${body}` with the endpoint secret (whsec_...).
 */
import { hmacSha256 } from "@kept/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { requireUserId } from "./lib/authz";
import { fail } from "./lib/errors";
import { LIMITS, rateLimit } from "./lib/rateLimit";
import { issueSecret } from "./lib/secrets";

const MAX_ATTEMPTS = 8;
const BACKOFF_MS = [10_000, 60_000, 300_000, 1_800_000, 3_600_000, 7_200_000, 21_600_000];
const MAX_ENDPOINTS = 5;

async function participantsOf(ctx: MutationCtx, stream: string): Promise<Id<"users">[]> {
  const cid = ctx.db.normalizeId("contracts", stream);
  if (cid) {
    const c = await ctx.db.get(cid);
    if (!c) return [];
    return [...new Set([c.creatorId, c.funderId, c.payeeId].filter((x): x is Id<"users"> => Boolean(x)))];
  }
  const mid = ctx.db.normalizeId("mandates", stream);
  if (mid) {
    const m = await ctx.db.get(mid);
    return m ? [m.ownerId] : [];
  }
  return [];
}

function matches(events: string[], type: string): boolean {
  return events.some((e) => e === "*" || e === type || (e.endsWith(".*") && type.startsWith(e.slice(0, -1))));
}

/** A user's endpoints that still receive events. Deleted ones keep their row (disabledAt), so read past them. */
async function liveEndpoints(ctx: MutationCtx, userId: Id<"users">) {
  const rows = await ctx.db
    .query("webhookEndpoints")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(100);
  return rows.filter((ep) => !ep.disabledAt);
}

/** Called by appendJournal in the same transaction as the journal entry. */
export async function enqueueOutboundWebhooks(ctx: MutationCtx, e: { journalId: Id<"journal">; stream: string; type: string }): Promise<void> {
  const users = await participantsOf(ctx, e.stream);
  const now = Date.now();
  for (const userId of users) {
    for (const ep of await liveEndpoints(ctx, userId)) {
      if (!matches(ep.events, e.type)) continue;
      const deliveryId = await ctx.db.insert("webhookDeliveries", {
        endpointId: ep._id,
        userId,
        journalId: e.journalId,
        eventType: e.type,
        status: "pending",
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.outbound.deliver, { deliveryId });
    }
  }
}

/** Only public https endpoints (SSRF guard). */
export function assertWebhookUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    fail("INVALID_ARGUMENT", "Webhook URL is not a valid URL.");
  }
  if (u.protocol !== "https:") fail("INVALID_ARGUMENT", "Webhook URL must use https.");
  // "localhost." is localhost: check the name without its trailing dots.
  const host = u.hostname.toLowerCase().replace(/\.+$/, "");
  const privateHost =
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.includes(":") ||
    host.startsWith("[");
  if (privateHost) fail("INVALID_ARGUMENT", "Webhook URL must be a public hostname (no IP literals or local names).");
  if (u.username || u.password) fail("INVALID_ARGUMENT", "Webhook URL must not contain credentials.");
  return u.toString();
}

export const _insertEndpoint = internalMutation({
  args: { userId: v.id("users"), url: v.string(), secret: v.string(), events: v.array(v.string()) },
  handler: async (ctx, a) => {
    await rateLimit(ctx, `whcreate:${a.userId}`, LIMITS.secretIssue);
    if ((await liveEndpoints(ctx, a.userId)).length >= MAX_ENDPOINTS) fail("INVALID_STATE", `At most ${MAX_ENDPOINTS} webhook endpoints.`);
    return await ctx.db.insert("webhookEndpoints", { userId: a.userId, url: a.url, secret: a.secret, events: a.events, failures: 0, createdAt: Date.now() });
  },
});

async function createEndpointFlow(ctx: { runMutation: any }, userId: Id<"users">, url: string, events?: string[]) {
  const clean = assertWebhookUrl(url);
  const evts = (events?.length ? events : ["*"]).map((e) => e.trim()).filter(Boolean).slice(0, 50);
  const secret = issueSecret("whsec");
  const endpointId: Id<"webhookEndpoints"> = await ctx.runMutation(internal.outbound._insertEndpoint, { userId, url: clean, secret: secret.token, events: evts });
  return { endpointId, url: clean, events: evts, secret: secret.token };
}

/** Register an endpoint. The signing secret is returned once. */
export const createEndpoint = action({
  args: { url: v.string(), events: v.optional(v.array(v.string())) },
  handler: async (ctx, { url, events }) => createEndpointFlow(ctx, await requireUserId(ctx), url, events),
});

export const createEndpointAs = internalAction({
  args: { userId: v.id("users"), url: v.string(), events: v.optional(v.array(v.string())) },
  handler: async (ctx, { userId, url, events }) => createEndpointFlow(ctx, userId, url, events),
});

export const listEndpoints = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db.query("webhookEndpoints").withIndex("by_user", (q) => q.eq("userId", userId)).take(20);
    return rows.map((r) => ({ _id: r._id, url: r.url, events: r.events, failures: r.failures, createdAt: r.createdAt, disabledAt: r.disabledAt ?? null }));
  },
});

export const deleteEndpoint = mutation({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, { endpointId }) => {
    const userId = await requireUserId(ctx);
    const ep = await ctx.db.get(endpointId);
    if (!ep || ep.userId !== userId) fail("NOT_FOUND", "Endpoint not found.");
    await ctx.db.patch(ep._id, { disabledAt: Date.now() });
  },
});

export const recentDeliveries = query({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, { endpointId }) => {
    const userId = await requireUserId(ctx);
    const ep = await ctx.db.get(endpointId);
    if (!ep || ep.userId !== userId) fail("NOT_FOUND", "Endpoint not found.");
    const rows = await ctx.db.query("webhookDeliveries").withIndex("by_endpoint", (q) => q.eq("endpointId", endpointId)).order("desc").take(50);
    return rows.map((r) => ({ _id: r._id, eventType: r.eventType, status: r.status, attempts: r.attempts, responseStatus: r.responseStatus ?? null, lastError: r.lastError ?? null, createdAt: r.createdAt }));
  },
});

export const _deliveryPayload = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const d = await ctx.db.get(deliveryId);
    if (!d || d.status !== "pending") return null;
    const ep = await ctx.db.get(d.endpointId);
    const j = await ctx.db.get(d.journalId);
    if (!ep || ep.disabledAt || !j) return null;
    return {
      url: ep.url,
      secret: ep.secret,
      body: JSON.stringify({
        type: j.type,
        timestamp: new Date(j.at).toISOString(),
        data: { stream: j.stream, seq: j.seq, at: j.at, actor: j.actor, type: j.type, data: j.data, hash: j.hash, prevHash: j.prevHash, sig: j.sig, keyId: j.keyId },
      }),
    };
  },
});

export const _result = internalMutation({
  args: { deliveryId: v.id("webhookDeliveries"), ok: v.boolean(), status: v.optional(v.number()), error: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const d = await ctx.db.get(a.deliveryId);
    if (!d || d.status !== "pending") return;
    const now = Date.now();
    const ep = await ctx.db.get(d.endpointId);
    if (a.ok) {
      await ctx.db.patch(d._id, { status: "delivered", attempts: d.attempts + 1, responseStatus: a.status, lastError: undefined, updatedAt: now });
      if (ep && ep.failures) await ctx.db.patch(ep._id, { failures: 0 });
      return;
    }
    const attempts = d.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch(d._id, { status: "failed", attempts, responseStatus: a.status, lastError: a.error, updatedAt: now });
      if (ep) await ctx.db.patch(ep._id, { failures: ep.failures + 1, ...(ep.failures + 1 >= 25 ? { disabledAt: now } : {}) });
      return;
    }
    const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
    await ctx.db.patch(d._id, { attempts, nextAttemptAt: now + delay, responseStatus: a.status, lastError: a.error, updatedAt: now });
    await ctx.scheduler.runAfter(delay, internal.outbound.deliver, { deliveryId: d._id });
  },
});

function secretKey(secret: string): Uint8Array {
  const b64 = secret.replace(/^whsec_/, "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export const deliver = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const p = await ctx.runQuery(internal.outbound._deliveryPayload, { deliveryId });
    if (!p) return;
    // The endpoint may predate a stricter guard; re-check before every send.
    try {
      assertWebhookUrl(p.url);
    } catch {
      await ctx.runMutation(internal.outbound._result, { deliveryId, ok: false, error: "blocked address" });
      return;
    }
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = toBase64(hmacSha256(secretKey(p.secret), `${deliveryId}.${ts}.${p.body}`));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    // lastError is shown to the endpoint owner: generic labels only, never response bodies or exception text.
    let outcome: { ok: boolean; status?: number; error?: string };
    try {
      const res = await fetch(p.url, {
        method: "POST",
        headers: { "content-type": "application/json", "webhook-id": deliveryId, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` },
        body: p.body,
        redirect: "manual",
        signal: controller.signal,
      });
      outcome = { ok: res.ok, status: res.status, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch {
      outcome = { ok: false, error: controller.signal.aborted ? "timeout" : "network error" };
    } finally {
      clearTimeout(timer);
    }
    await ctx.runMutation(internal.outbound._result, { deliveryId, ...outcome });
  },
});

/** Cron: retry anything whose scheduled attempt was missed. */
export const deliverDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_status_next", (q) => q.eq("status", "pending").lt("nextAttemptAt", now - 120_000))
      .take(100);
    for (const d of due) {
      // A disabled endpoint never gets its delivery; close it so it stops coming back here.
      const ep = await ctx.db.get(d.endpointId);
      if (!ep || ep.disabledAt) await ctx.db.patch(d._id, { status: "failed", lastError: "endpoint disabled", updatedAt: now });
      else await ctx.scheduler.runAfter(0, internal.outbound.deliver, { deliveryId: d._id });
    }
  },
});
