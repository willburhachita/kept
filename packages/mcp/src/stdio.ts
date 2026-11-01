/**
 * MCP stdio transport: newline-delimited JSON-RPC. stdout carries protocol
 * messages only; diagnostics go to stderr.
 */
import type { McpServer } from "./protocol.js";

/** Split a byte stream into complete lines (handles partial chunks and CRLF). */
export function createLineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    let i: number;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i).replace(/\r$/, "");
      buffer = buffer.slice(i + 1);
      if (line.trim()) onLine(line);
    }
  };
}

export function runStdio(server: McpServer): void {
  const write = (obj: unknown) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.stdin.setEncoding("utf8");
  const split = createLineSplitter((line) => {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    server
      .handle(msg)
      .then((res) => res && write(res))
      .catch((e) => process.stderr.write(`kept-mcp: ${e instanceof Error ? e.message : String(e)}\n`));
  });
  process.stdin.on("data", split);
  process.stdin.on("end", () => process.exit(0));
}
