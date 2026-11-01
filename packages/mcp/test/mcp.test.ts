import { GENESIS_HASH, generateSigningKey, logoFixed, logoNaive, sealJournalEntry, irHash, verify } from "@kept/core";
import { describe, expect, it } from "vitest";
import { createKeptServer } from "../src/index.js";
import { createLineSplitter } from "../src/stdio.js";
import { remoteTools, verifyProofPack } from "../src/tools.js";

const server = createKeptServer({});
const call = (method: string, params?: unknown, id: number = 1) => server.handle({ jsonrpc: "2.0", id, method, params });

describe("MCP protocol", () => {
  it("negotiates the protocol version and lists tools", async () => {
    const init = (await call("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } })) as any;
    expect(init.result.protocolVersion).toBe("2025-03-26");
    expect(init.result.capabilities.tools).toBeDefined();
    expect((await call("initialize", { protocolVersion: "1999-01-01" })) as any).toMatchObject({ result: { protocolVersion: "2025-06-18" } });
    expect(await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const list = (await call("tools/list")) as any;
    expect(list.result.tools.map((t: any) => t.name)).toContain("verify_contract");
    expect(list.result.tools.every((t: any) => t.inputSchema.type === "object" && !("handler" in t))).toBe(true);
  });

  it("verifies contracts and surfaces counterexamples", async () => {
    const bad = (await call("tools/call", { name: "verify_contract", arguments: { contract: logoNaive } })) as any;
    expect(bad.result.isError).toBe(false);
    expect(bad.result.structuredContent.ok).toBe(false);
    const promise = bad.result.structuredContent.properties.find((p: any) => p.id === "promise:designer_paid");
    expect(promise.counterexample.steps).toHaveLength(3);
    const good = (await call("tools/call", { name: "verify_contract", arguments: { contract: JSON.stringify(logoFixed), fee_bps: 250 } })) as any;
    expect(good.result.structuredContent.ok).toBe(true);
    const explained = (await call("tools/call", { name: "explain_contract", arguments: { contract: logoFixed } })) as any;
    expect(explained.result.structuredContent.rules).toHaveLength(4);
  });

  it("rejects unknown tools, bad arguments and unknown methods", async () => {
    expect(((await call("tools/call", { name: "nope", arguments: {} })) as any).error.code).toBe(-32602);
    expect(((await call("tools/call", { name: "verify_contract", arguments: {} })) as any).error.message).toMatch(/contract/);
    expect(((await call("tools/call", { name: "verify_contract", arguments: { contract: logoFixed, fee_bps: "x" } })) as any).error.code).toBe(-32602);
    expect(((await call("bogus/method")) as any).error.code).toBe(-32601);
    expect(((await server.handle([{}])) as any).error.code).toBe(-32600);
  });

  it("only exposes remote tools when configured", () => {
    expect(remoteTools({})).toHaveLength(0);
    expect(remoteTools({ KEPT_API_URL: "https://x.convex.site", KEPT_MANDATE_TOKEN: "mt_x" }).map((t) => t.name)).toEqual(["get_mandate", "request_spend", "get_spend"]);
  });
});

describe("proof packs", () => {
  it("accepts a genuine pack and rejects a tampered one", () => {
    const key = generateSigningKey();
    const journal = [];
    let prev = GENESIS_HASH;
    for (let seq = 1; seq <= 3; seq++) {
      const e = sealJournalEntry({ stream: "c1", seq, at: seq, actor: "system", type: "t", data: { seq }, prevHash: prev }, key);
      journal.push(e);
      prev = e.hash;
    }
    const report = verify(logoFixed, { feeBps: 0 });
    const pack = { ir: logoFixed, irHash: irHash(logoFixed), feeBps: 0, verification: { ok: report.ok, summary: report.summary }, journal, signingKeys: { [key.keyId]: key.publicKeyHex } };
    expect(verifyProofPack(pack).verdict).toBe("valid");
    const tampered = { ...pack, journal: pack.journal.map((e, i) => (i === 1 ? { ...e, data: { seq: 42 } } : e)) };
    expect(verifyProofPack(tampered).verdict).toBe("INVALID");
  });
});

describe("stdio framing", () => {
  it("reassembles partial lines and ignores blanks", () => {
    const lines: string[] = [];
    const split = createLineSplitter((l) => lines.push(l));
    split('{"a":');
    split('1}\r\n\n{"b":2}');
    split("\n");
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });
});
