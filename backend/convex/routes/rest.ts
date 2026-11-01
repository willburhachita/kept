/**
 * REST API v1 for developers (Authorization: Bearer sk_test_...). Every
 * route calls the same service functions the app uses, via their internal
 * "...As" twins, so behaviour and authorization are identical.
 */
import { verifyContract } from "@kept/core";
import type { HttpRouter } from "convex/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { httpAction, type ActionCtx } from "../_generated/server";
import { fail } from "../lib/errors";
import { bearer, hashSecret } from "../lib/secrets";
import { CORS, errorJson, errorResponse, json, readJson } from "./public";

interface Call {
  ctx: ActionCtx;
  req: Request;
  url: URL;
  p: string[];
  body: Record<string, any>;
  userId: Id<"users">;
}

interface Route {
  method: "GET" | "POST" | "PUT";
  re: RegExp;
  auth: boolean;
  run: (c: Call) => Promise<unknown>;
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v.trim()) fail("INVALID_ARGUMENT", `${name} is required.`);
  return v;
};
const optStr = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const C = (s: string) => s as Id<"contracts">;
const M = (s: string) => s as Id<"mandates">;

const ROUTES: Route[] = [
  // Public
  {
    method: "GET",
    re: /^\/v1\/transparency\/checkpoints$/,
    auth: false,
    run: ({ ctx, url }) => ctx.runQuery(internal.transparency.listCheckpoints, { limit: Number(url.searchParams.get("limit") ?? 20) || 20 }),
  },
  {
    method: "GET",
    re: /^\/v1\/transparency\/proof\/([0-9a-fA-F]{64})$/,
    auth: false,
    run: async ({ ctx, p }) => (await ctx.runQuery(internal.transparency.proofFor, { entryHash: p[0] })) ?? fail("NOT_FOUND", "No journal entry with that hash."),
  },

  // Account
  { method: "GET", re: /^\/v1\/me$/, auth: true, run: ({ ctx, userId }) => ctx.runQuery(internal.apiKeys.me, { userId }) },

  // Verification: exhaustive checking is CPU-heavy, so it needs a key and shares the app's per-user verify budget.
  {
    method: "POST",
    re: /^\/v1\/verify$/,
    auth: true,
    run: async ({ ctx, userId, body }) => {
      await ctx.runMutation(internal.verification._limit, { key: `verify:${userId}` });
      const fee = body.feeBps;
      if (fee !== undefined && (!Number.isInteger(fee) || fee < 0 || fee > 2000)) fail("INVALID_ARGUMENT", "feeBps must be an integer 0-2000.");
      const r = verifyContract(body.ir ?? body.contract, { feeBps: fee ?? 0, maxStates: 50_000 });
      return r.valid ? { valid: true, report: r.report, warnings: r.issues } : { valid: false, issues: r.issues };
    },
  },

  // Contracts
  {
    method: "POST",
    re: /^\/v1\/contracts$/,
    auth: true,
    run: async ({ ctx, userId, body }) => {
      const role = body.role === "payee" ? "payee" : body.role === "funder" ? "funder" : fail("INVALID_ARGUMENT", 'role must be "funder" or "payee".');
      const created: { contractId: Id<"contracts">; inviteToken: string; inviteUrl: string } = await ctx.runAction(internal.contracts.createAs, {
        userId,
        prompt: typeof body.prompt === "string" ? body.prompt : "",
        role,
        counterpartyEmail: optStr(body.counterpartyEmail),
        ir: body.ir ?? undefined,
      });
      if (body.compile === true && !body.ir) await ctx.scheduler.runAfter(0, internal.compiler.compileAs, { userId, contractId: created.contractId });
      return { ...created, compiling: body.compile === true && !body.ir };
    },
  },
  { method: "GET", re: /^\/v1\/contracts$/, auth: true, run: async ({ ctx, userId }) => ({ data: await ctx.runQuery(internal.contracts.listAs, { userId }) }) },
  { method: "GET", re: /^\/v1\/contracts\/([^/]+)$/, auth: true, run: ({ ctx, userId, p }) => ctx.runQuery(internal.contracts.getAs, { userId, contractId: C(p[0]) }) },
  {
    method: "POST",
    re: /^\/v1\/contracts\/([^/]+)\/compile$/,
    auth: true,
    run: async ({ ctx, userId, p }) => {
      await ctx.runQuery(internal.contracts.getAs, { userId, contractId: C(p[0]) }); // access check before scheduling
      await ctx.scheduler.runAfter(0, internal.compiler.compileAs, { userId, contractId: C(p[0]) });
      return { started: true, poll: `/v1/contracts/${p[0]}/compile` };
    },
  },
  { method: "GET", re: /^\/v1\/contracts\/([^/]+)\/compile$/, auth: true, run: ({ ctx, userId, p }) => ctx.runQuery(internal.compiler.latestRunAs, { userId, contractId: C(p[0]) }) },
  { method: "PUT", re: /^\/v1\/contracts\/([^/]+)\/terms$/, auth: true, run: ({ ctx, userId, p, body }) => ctx.runMutation(internal.contracts.setTermsAs, { userId, contractId: C(p[0]), ir: body.ir }) },
  {
    method: "POST",
    re: /^\/v1\/contracts\/([^/]+)\/approve$/,
    auth: true,
    run: ({ ctx, userId, p, body }) => ctx.runMutation(internal.contracts.approveAs, { userId, contractId: C(p[0]), termsHash: str(body.termsHash, "termsHash") }),
  },
  { method: "POST", re: /^\/v1\/contracts\/([^/]+)\/fund$/, auth: true, run: ({ ctx, userId, p }) => ctx.runAction(internal.funding.startAs, { userId, contractId: C(p[0]) }) },
  { method: "POST", re: /^\/v1\/contracts\/([^/]+)\/fund\/confirm$/, auth: true, run: ({ ctx, userId, p }) => ctx.runAction(internal.funding.confirmAs, { userId, contractId: C(p[0]) }) },
  { method: "POST", re: /^\/v1\/contracts\/([^/]+)\/fund\/reset$/, auth: true, run: ({ ctx, userId, p }) => ctx.runAction(internal.funding.resetAs, { userId, contractId: C(p[0]) }) },
  { method: "POST", re: /^\/v1\/contracts\/([^/]+)\/cancel$/, auth: true, run: ({ ctx, userId, p }) => ctx.runMutation(internal.contracts.cancelAs, { userId, contractId: C(p[0]) }) },
  { method: "POST", re: /^\/v1\/contracts\/([^/]+)\/uploads$/, auth: true, run: ({ ctx, userId, p }) => ctx.runMutation(internal.evidence.generateUploadUrlAs, { userId, contractId: C(p[0]) }) },
  {
    method: "POST",
    re: /^\/v1\/contracts\/([^/]+)\/evidence$/,
    auth: true,
    run: ({ ctx, userId, p, body }) =>
      ctx.runMutation(internal.evidence.submitAs, {
        userId,
        contractId: C(p[0]),
        slotId: str(body.slotId, "slotId"),
        storageId: optStr(body.storageId) as Id<"_storage"> | undefined,
        fileName: optStr(body.fileName),
        text: optStr(body.text),
        url: optStr(body.url),
      }),
  },
  { method: "GET", re: /^\/v1\/contracts\/([^/]+)\/evidence$/, auth: true, run: async ({ ctx, userId, p }) => ({ data: await ctx.runQuery(internal.evidence.listAs, { userId, contractId: C(p[0]) }) }) },
  {
    method: "GET",
    re: /^\/v1\/contracts\/([^/]+)\/journal$/,
    auth: true,
    run: async ({ ctx, userId, p, url }) => ({ data: await ctx.runQuery(internal.contracts.journalAs, { userId, contractId: C(p[0]), limit: Number(url.searchParams.get("limit") ?? 200) || 200 }) }),
  },
  { method: "GET", re: /^\/v1\/contracts\/([^/]+)\/proof$/, auth: true, run: ({ ctx, userId, p }) => ctx.runQuery(internal.contracts.proofAs, { userId, contractId: C(p[0]) }) },
  {
    method: "POST",
    re: /^\/v1\/evidence\/([^/]+)\/(accept|reject|challenge|dispute)$/,
    auth: true,
    run: ({ ctx, userId, p, body }) => {
      const evidenceId = p[0] as Id<"evidence">;
      switch (p[1]) {
        case "accept":
          return ctx.runMutation(internal.evidence.acceptAs, { userId, evidenceId });
        case "reject":
          return ctx.runMutation(internal.evidence.rejectAs, { userId, evidenceId, reason: str(body.reason, "reason") });
        case "challenge":
          return ctx.runMutation(internal.evidence.challengeAs, { userId, evidenceId, reason: str(body.reason, "reason") });
        default:
          return ctx.runMutation(internal.evidence.disputeAs, { userId, evidenceId, reason: str(body.reason, "reason") });
      }
    },
  },
  { method: "POST", re: /^\/v1\/invites\/accept$/, auth: true, run: ({ ctx, userId, body }) => ctx.runMutation(internal.contracts.acceptInviteAs, { userId, token: str(body.token, "token") }) },

  // Mandates
  { method: "POST", re: /^\/v1\/mandates$/, auth: true, run: ({ ctx, userId, body }) => ctx.runMutation(internal.mandates.createAs, { userId, policy: body.policy, prompt: optStr(body.prompt) }) },
  { method: "GET", re: /^\/v1\/mandates$/, auth: true, run: async ({ ctx, userId }) => ({ data: await ctx.runQuery(internal.mandates.listAs, { userId }) }) },
  { method: "GET", re: /^\/v1\/mandates\/([^/]+)$/, auth: true, run: ({ ctx, userId, p }) => ctx.runQuery(internal.mandates.getAs, { userId, mandateId: M(p[0]) }) },
  { method: "POST", re: /^\/v1\/mandates\/([^/]+)\/fund$/, auth: true, run: ({ ctx, userId, p }) => ctx.runAction(internal.mandates.fundStartAs, { userId, mandateId: M(p[0]) }) },
  { method: "POST", re: /^\/v1\/mandates\/([^/]+)\/fund\/confirm$/, auth: true, run: ({ ctx, userId, p }) => ctx.runAction(internal.mandates.fundConfirmAs, { userId, mandateId: M(p[0]) }) },
  {
    method: "POST",
    re: /^\/v1\/mandates\/([^/]+)\/tokens$/,
    auth: true,
    run: ({ ctx, userId, p, body }) =>
      ctx.runAction(internal.mandates.issueTokenAs, {
        userId,
        mandateId: M(p[0]),
        label: typeof body.label === "string" ? body.label : "agent",
        expiresInHours: typeof body.expiresInHours === "number" ? body.expiresInHours : undefined,
      }),
  },
  { method: "POST", re: /^\/v1\/mandates\/([^/]+)\/revoke$/, auth: true, run: ({ ctx, userId, p }) => ctx.runMutation(internal.mandates.revokeAs, { userId, mandateId: M(p[0]) }) },
  { method: "GET", re: /^\/v1\/mandates\/([^/]+)\/spends$/, auth: true, run: async ({ ctx, userId, p }) => ({ data: await ctx.runQuery(internal.mandates.spendsAs, { userId, mandateId: M(p[0]) }) }) },
  {
    method: "POST",
    re: /^\/v1\/spends\/([^/]+)\/decide$/,
    auth: true,
    run: ({ ctx, userId, p, body }) => {
      if (typeof body.approve !== "boolean") fail("INVALID_ARGUMENT", "approve must be true or false.");
      return ctx.runMutation(internal.mandates.decideSpendAs, { userId, spendId: p[0] as Id<"spends">, approve: body.approve, reason: optStr(body.reason) });
    },
  },

  // Developer webhooks
  {
    method: "POST",
    re: /^\/v1\/webhooks\/endpoints$/,
    auth: true,
    run: ({ ctx, userId, body }) =>
      ctx.runAction(internal.outbound.createEndpointAs, { userId, url: str(body.url, "url"), events: Array.isArray(body.events) ? body.events.filter((e: unknown) => typeof e === "string") : undefined }),
  },
];

async function authenticate(ctx: ActionCtx, req: Request): Promise<Id<"users">> {
  const token = bearer(req.headers.get("authorization"));
  if (!token || !token.startsWith("sk_")) fail("UNAUTHENTICATED", "Send Authorization: Bearer sk_... (create a key in the dashboard).");
  const found: { userId: Id<"users">; keyId: Id<"apiKeys"> } | null = await ctx.runQuery(internal.apiKeys.authenticate, { keyHash: hashSecret(token) });
  if (!found) fail("UNAUTHENTICATED", "Invalid or revoked API key.");
  await ctx.runMutation(internal.apiKeys._touch, { keyId: found.keyId });
  return found.userId;
}

const handler = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const candidates = ROUTES.filter((r) => r.re.test(path));
  const route = candidates.find((r) => r.method === req.method);
  if (!route) return candidates.length ? errorJson(405, "METHOD_NOT_ALLOWED", `Use ${candidates.map((r) => r.method).join(" or ")}.`, CORS) : errorJson(404, "NOT_FOUND", "No such endpoint.", CORS);
  try {
    const userId = route.auth ? await authenticate(ctx, req) : ("" as Id<"users">);
    const body = req.method === "GET" ? {} : await readJson(req);
    const p = (path.match(route.re) ?? []).slice(1).map(decodeURIComponent);
    const result = await route.run({ ctx, req, url, p, body, userId });
    return json(200, result ?? { ok: true }, route.auth ? {} : CORS);
  } catch (e) {
    return errorResponse(e, route.auth ? {} : CORS);
  }
});

export function registerRestApi(http: HttpRouter): void {
  for (const method of ["GET", "POST", "PUT"] as const) http.route({ pathPrefix: "/v1/", method, handler });
  http.route({ pathPrefix: "/v1/", method: "OPTIONS", handler: httpAction(async () => new Response(null, { status: 204, headers: CORS })) });
}
