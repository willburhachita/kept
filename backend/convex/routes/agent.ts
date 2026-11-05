/**
 * Agent API (Authorization: Bearer mt_...). An AI agent reads its mandate
 * and asks to spend; the deterministic guard decides.
 *
 *   GET  /agent/v1/mandate
 *   POST /agent/v1/spends      {merchantEmail, merchantName, amountCents, currency, description, idempotencyKey}
 *   GET  /agent/v1/spends/{id}
 */
import type { HttpRouter } from "convex/server";
import { internal } from "../_generated/api";
import { httpAction, type ActionCtx } from "../_generated/server";
import { fail } from "../lib/errors";
import { bearer, hashSecret } from "../lib/secrets";
import { CORS, errorJson, errorResponse, json, readJson } from "./public";

/** Shared with the MCP route. */
export function agentTokenHash(req: Request): string {
  const token = bearer(req.headers.get("authorization"));
  if (!token || !token.startsWith("mt_")) fail("UNAUTHENTICATED", "Send Authorization: Bearer mt_... (a mandate token).");
  return hashSecret(token);
}

export interface SpendInput {
  merchantEmail: string;
  merchantName: string;
  amountCents: number;
  currency: string;
  description: string;
  idempotencyKey: string;
}

export function parseSpendInput(b: Record<string, any>): SpendInput {
  const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
  if (!Number.isSafeInteger(b.amountCents)) fail("INVALID_ARGUMENT", "amountCents must be a whole number of cents.");
  if (!s("merchantEmail")) fail("INVALID_ARGUMENT", "merchantEmail is required (the merchant's PayPal email).");
  if (!s("idempotencyKey")) fail("INVALID_ARGUMENT", "idempotencyKey is required (reuse it to retry safely).");
  return {
    merchantEmail: s("merchantEmail"),
    merchantName: s("merchantName") || s("merchantEmail"),
    amountCents: b.amountCents,
    currency: (s("currency") || "USD").toUpperCase(),
    description: s("description"),
    idempotencyKey: s("idempotencyKey"),
  };
}

export async function agentMandate(ctx: ActionCtx, tokenHash: string) {
  const m = await ctx.runQuery(internal.agentApi.mandateForAgent, { tokenHash });
  if (!m) fail("UNAUTHENTICATED", "Invalid, revoked or expired mandate token.");
  return m;
}

export async function agentSpend(ctx: ActionCtx, tokenHash: string, input: SpendInput) {
  return await ctx.runMutation(internal.agentApi.requestSpend, { tokenHash, ...input });
}

export async function agentGetSpend(ctx: ActionCtx, tokenHash: string, spendId: string) {
  const s = await ctx.runQuery(internal.agentApi.getSpend, { tokenHash, spendId });
  if (!s) fail("NOT_FOUND", "Spend not found for this mandate.");
  return s;
}

const handler = httpAction(async (ctx, req) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  try {
    const tokenHash = agentTokenHash(req);
    if (req.method === "GET" && path === "/agent/v1/mandate") return json(200, await agentMandate(ctx, tokenHash), CORS);
    if (req.method === "POST" && path === "/agent/v1/spends") return json(200, await agentSpend(ctx, tokenHash, parseSpendInput(await readJson(req, 16 * 1024))), CORS);
    const m = /^\/agent\/v1\/spends\/([^/]+)$/.exec(path);
    if (req.method === "GET" && m) return json(200, await agentGetSpend(ctx, tokenHash, decodeURIComponent(m[1])), CORS);
    return errorJson(404, "NOT_FOUND", "No such endpoint.", CORS);
  } catch (e) {
    // Agents may run in a browser: every answer carries CORS, not just the preflight.
    return errorResponse(e, CORS);
  }
});

export function registerAgentApi(http: HttpRouter): void {
  http.route({ pathPrefix: "/agent/v1/", method: "GET", handler });
  http.route({ pathPrefix: "/agent/v1/", method: "POST", handler });
  http.route({ pathPrefix: "/agent/v1/", method: "OPTIONS", handler: httpAction(async () => new Response(null, { status: 204, headers: CORS })) });
}
