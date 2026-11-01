/**
 * Shared HTTP helpers plus the public, unauthenticated endpoints.
 */
import { ENGINE_VERSION } from "@kept/core";
import type { HttpRouter } from "convex/server";
import { httpAction } from "../_generated/server";
import { env, signingKey } from "../lib/env";
import { fail, httpStatusFor, isAppError } from "../lib/errors";

export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, accept",
  "access-control-max-age": "86400",
};

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
}

export function errorJson(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return json(status, { error: { code, message } }, headers);
}

/** Map any thrown error to a safe JSON response (never leaks internals). */
export function errorResponse(e: unknown, headers: Record<string, string> = {}): Response {
  if (isAppError(e)) {
    const { code, message, ...rest } = e.data;
    return json(httpStatusFor(code), { error: { code, message, ...rest } }, headers);
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/validator|not a valid id|ArgumentValidationError|Invalid argument/i.test(msg)) return errorJson(404, "NOT_FOUND", "Not found (or an id is malformed).", headers);
  console.error("HTTP handler error:", msg);
  return errorJson(500, "INTERNAL", "Unexpected error.", headers);
}

export async function readJson(req: Request, maxBytes = 256 * 1024): Promise<Record<string, any>> {
  const text = await req.text();
  if (text.length > maxBytes) fail("INVALID_ARGUMENT", "Request body is too large.");
  if (!text.trim()) return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    fail("INVALID_ARGUMENT", "Request body must be valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) fail("INVALID_ARGUMENT", "Request body must be a JSON object.");
  return body as Record<string, any>;
}

export function registerPublic(http: HttpRouter): void {
  http.route({
    path: "/health",
    method: "GET",
    handler: httpAction(async () => json(200, { ok: true, service: env.brandName(), engine: ENGINE_VERSION, rail: env.rail(), time: Date.now() }, CORS)),
  });

  /** Public key that verifies every receipt and checkpoint signature. */
  http.route({
    path: "/.well-known/kept-keys.json",
    method: "GET",
    handler: httpAction(async () => {
      try {
        const k = signingKey();
        return json(200, { keys: [{ keyId: k.keyId, alg: "Ed25519", publicKey: k.publicKeyHex, use: ["receipt", "checkpoint"] }] }, { ...CORS, "cache-control": "public, max-age=300" });
      } catch (e) {
        return errorResponse(e, CORS);
      }
    }),
  });
}
