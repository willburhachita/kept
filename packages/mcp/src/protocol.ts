/**
 * A dependency-free MCP server core: JSON-RPC 2.0 dispatch for tools-only
 * servers. Transport-agnostic; see stdio.ts for the stdio framing.
 */

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export type JsonSchema = {
  type: "object";
  properties: Record<string, { type?: string; description?: string; [k: string]: unknown }>;
  required?: string[];
  additionalProperties?: boolean;
};

export interface Tool {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

export interface ServerOptions {
  name: string;
  version: string;
  instructions?: string;
  tools: () => Tool[];
}

type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: any };

const ok = (id: unknown, result: unknown) => ({ jsonrpc: "2.0" as const, id, result });
const err = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } });

const TYPE_OF: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === "string",
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === "number" && Number.isFinite(v),
  boolean: (v) => typeof v === "boolean",
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v),
};

/** Minimal argument check: required keys, declared primitive types, no unknown keys when closed. */
export function checkArgs(schema: JsonSchema, args: Record<string, unknown>): string | null {
  for (const k of schema.required ?? []) if (args[k] === undefined || args[k] === null) return `Missing required argument "${k}".`;
  for (const [k, v] of Object.entries(args)) {
    const prop = schema.properties[k];
    if (!prop) {
      if (schema.additionalProperties === false) return `Unknown argument "${k}".`;
      continue;
    }
    if (prop.type && TYPE_OF[prop.type] && v !== undefined && v !== null && !TYPE_OF[prop.type](v)) return `Argument "${k}" must be ${prop.type}.`;
  }
  return null;
}

export function toolResult(value: unknown, isError = false) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text", text }],
    ...(typeof value === "object" && value !== null && !Array.isArray(value) ? { structuredContent: value } : {}),
    isError,
  };
}

export function createServer(opts: ServerOptions) {
  return {
    /** Handle one decoded JSON-RPC message. Returns the response, or null for notifications. */
    async handle(message: unknown): Promise<object | null> {
      if (Array.isArray(message)) return err(null, -32600, "Batch requests are not supported.");
      const msg = message as Message;
      if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return err(msg?.id, -32600, "Invalid JSON-RPC request.");
      if (msg.id === undefined || msg.id === null) return null;
      const id = msg.id;
      switch (msg.method) {
        case "initialize": {
          const requested = msg.params?.protocolVersion;
          const protocolVersion = (PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : PROTOCOL_VERSIONS[0];
          return ok(id, {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: opts.name, version: opts.version },
            ...(opts.instructions ? { instructions: opts.instructions } : {}),
          });
        }
        case "ping":
          return ok(id, {});
        case "tools/list":
          return ok(id, { tools: opts.tools().map(({ handler: _h, ...t }) => t) });
        case "tools/call": {
          const name = msg.params?.name;
          const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
          const tool = opts.tools().find((t) => t.name === name);
          if (!tool) return err(id, -32602, `Unknown tool: ${String(name)}`);
          if (typeof args !== "object" || args === null || Array.isArray(args)) return err(id, -32602, "arguments must be an object.");
          const problem = checkArgs(tool.inputSchema, args);
          if (problem) return err(id, -32602, problem);
          try {
            return ok(id, toolResult(await tool.handler(args)));
          } catch (e) {
            return ok(id, toolResult(`Error: ${e instanceof Error ? e.message : String(e)}`, true));
          }
        }
        default:
          return err(id, -32601, `Method not found: ${msg.method}`);
      }
    },
  };
}

export type McpServer = ReturnType<typeof createServer>;
