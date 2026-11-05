/**
 * Remote MCP endpoint (Streamable HTTP, JSON responses) for agents holding a
 * mandate token. Any MCP client can connect:
 *   claude mcp add --transport http kept https://<deployment>.convex.site/mcp \
 *     --header "Authorization: Bearer mt_..."
 * The JSON-RPC dispatcher is a pure function so it can be tested directly.
 */
import type { HttpRouter } from "convex/server";
import { httpAction } from "../_generated/server";
import { agentProductSearch } from "../shopping";
import { isAppError } from "../lib/errors";
import { agentGetSpend, agentMandate, agentSpend, agentTokenHash, parseSpendInput } from "./agent";
import { CORS, errorResponse, json } from "./public";

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const MCP_INSTRUCTIONS =
  "You are connected to a spending mandate. You can spend only inside its limits (budget, per-purchase cap, merchant allowlist, expiry, hourly velocity). " +
  "Call get_mandate first to see what is allowed and how much is left. Use find_products to search real products: it only returns offers this mandate allows, each with the exact arguments for request_spend. Call request_spend for each purchase with the merchant's PayPal email and a clear description. " +
  "A 'denied' result is a final policy answer: do not retry it with different wording. 'needs_approval' means the owner must approve; check later with get_spend. " +
  "Reuse the same idempotency_key when retrying the same purchase after a network error.";

export const MCP_TOOLS = [
  {
    name: "get_mandate",
    title: "Get mandate",
    description: "Read the spending mandate: purpose, remaining budget, per-purchase limit, approval threshold, allowed merchants, purchases left and expiry. Call this before spending.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "request_spend",
    title: "Request a purchase",
    description:
      "Ask to pay a merchant from the mandate. The policy is checked deterministically; the answer is one of executing (approved, paying now), screening (being reviewed), needs_approval (waiting for the owner), denied (final, with reasons).",
    inputSchema: {
      type: "object",
      properties: {
        merchant_email: { type: "string", description: "The merchant's PayPal email address (receives the payment)." },
        merchant_name: { type: "string", description: "Merchant display name." },
        amount_cents: { type: "integer", description: "Amount in cents, e.g. 1299 for $12.99." },
        currency: { type: "string", description: "ISO currency, must match the mandate (usually USD)." },
        description: { type: "string", description: "What is being bought and why it fits the mandate's purpose." },
        idempotency_key: { type: "string", description: "Unique key for this purchase; reuse it to retry safely." },
      },
      required: ["merchant_email", "merchant_name", "amount_cents", "currency", "description", "idempotency_key"],
      additionalProperties: false,
    },
  },
  {
    name: "find_products",
    title: "Find products",
    description:
      "Search real products (via Channel3) within this mandate. The budget is applied to the search itself, and every offer is checked against the policy: you only get offers you are allowed to buy (or that need the owner's approval), each with a ready-made `purchase` object for request_spend. Offers the policy blocks are hidden and counted by reason.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for, e.g. \"A4 printer paper 500 sheets\"." },
        limit: { type: "integer", description: "Products to search (1-30, default 12). Each can have several offers." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_spend",
    title: "Get purchase status",
    description: "Check the status of a purchase you requested (for example after needs_approval or screening).",
    inputSchema: { type: "object", properties: { spend_id: { type: "string" } }, required: ["spend_id"], additionalProperties: false },
  },
];

export interface McpDeps {
  getMandate(): Promise<unknown>;
  requestSpend(args: Record<string, unknown>): Promise<unknown>;
  getSpend(spendId: string): Promise<unknown>;
  findProducts?(query: string, limit: unknown): Promise<unknown>;
}

export interface McpReply {
  status: number;
  body?: unknown;
}

type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: any };

const ok = (id: unknown, result: unknown): McpReply => ({ status: 200, body: { jsonrpc: "2.0", id, result } });
const rpcError = (id: unknown, code: number, message: string, status = 200): McpReply => ({ status, body: { jsonrpc: "2.0", id: id ?? null, error: { code, message } } });

function toolResult(value: unknown, isError = false) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], ...(typeof value === "object" && value !== null ? { structuredContent: value } : {}), isError };
}

/** Pure JSON-RPC / MCP dispatcher. */
export async function handleMcpRequest(message: unknown, deps: McpDeps): Promise<McpReply> {
  if (Array.isArray(message)) return rpcError(null, -32600, "Batch requests are not supported.");
  const msg = message as Rpc;
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "Invalid JSON-RPC request.", 400);
  if (msg.id === undefined || msg.id === null) return { status: 202 }; // notification
  const id = msg.id;
  switch (msg.method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion;
      return ok(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "kept-mandate", version: "0.1.0" },
        instructions: MCP_INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: MCP_TOOLS });
    case "tools/call": {
      const name = msg.params?.name;
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const tool = MCP_TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(name)}`);
      const required = (tool.inputSchema as { required?: string[] }).required ?? [];
      const missing = required.filter((k) => args[k] === undefined || args[k] === null || args[k] === "");
      if (missing.length) return rpcError(id, -32602, `Missing arguments: ${missing.join(", ")}`);
      try {
        if (name === "get_mandate") return ok(id, toolResult(await deps.getMandate()));
        if (name === "get_spend") return ok(id, toolResult(await deps.getSpend(String(args.spend_id))));
        if (name === "find_products") {
          if (!deps.findProducts) return ok(id, toolResult("Error: product search is not available here.", true));
          return ok(id, toolResult(await deps.findProducts(String(args.query), args.limit)));
        }
        return ok(id, toolResult(await deps.requestSpend(args)));
      } catch (e) {
        const message = isAppError(e) ? e.data.message : e instanceof Error ? e.message : String(e);
        return ok(id, toolResult(`Error: ${message}`, true));
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

export function registerMcp(http: HttpRouter): void {
  http.route({
    path: "/mcp",
    method: "POST",
    handler: httpAction(async (ctx, req) => {
      let tokenHash: string;
      try {
        tokenHash = agentTokenHash(req);
        await agentMandate(ctx, tokenHash);
      } catch (e) {
        const r = errorResponse(e, { ...CORS, "www-authenticate": 'Bearer realm="mandate"' });
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: send Authorization: Bearer mt_..." } }), {
          status: r.status === 401 ? 401 : r.status,
          headers: { "content-type": "application/json", ...CORS, "www-authenticate": 'Bearer realm="mandate"' },
        });
      }
      const text = await req.text();
      if (text.length > 64 * 1024) return json(413, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large." } }, CORS);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }, CORS);
      }
      const reply = await handleMcpRequest(body, {
        getMandate: () => agentMandate(ctx, tokenHash),
        getSpend: (spendId) => agentGetSpend(ctx, tokenHash, spendId),
        findProducts: (query, limit) => agentProductSearch(ctx, tokenHash, query, limit),
        requestSpend: (a) =>
          agentSpend(
            ctx,
            tokenHash,
            parseSpendInput({
              merchantEmail: a.merchant_email,
              merchantName: a.merchant_name,
              amountCents: a.amount_cents,
              currency: a.currency,
              description: a.description,
              idempotencyKey: a.idempotency_key,
            }),
          ),
      });
      return reply.body === undefined ? new Response(null, { status: reply.status, headers: CORS }) : json(reply.status, reply.body, CORS);
    }),
  });
  const notAllowed = httpAction(async () => new Response(JSON.stringify({ error: "Use POST for MCP requests (no SSE stream on this server)." }), { status: 405, headers: { ...CORS, allow: "POST, OPTIONS", "content-type": "application/json" } }));
  http.route({ path: "/mcp", method: "GET", handler: notAllowed });
  http.route({ path: "/mcp", method: "DELETE", handler: notAllowed });
  http.route({ path: "/mcp", method: "OPTIONS", handler: httpAction(async () => new Response(null, { status: 204, headers: CORS })) });
}
