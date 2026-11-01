import { GENESIS_HASH, generateSigningKey, hmacSha256, sealJournalEntry } from "@kept/core";
import { describe, expect, it, vi } from "vitest";
import { Kept, KeptAgent, KeptApiError, verifyJournalEntry, verifyWebhook } from "../src/index.js";

function mockFetch(handler: (url: string, init: RequestInit) => { status: number; body?: unknown }) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const r = handler(String(url), init ?? {});
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("Kept client", () => {
  it("sends auth, method, path and JSON body", async () => {
    const f = mockFetch((url, init) => {
      expect(url).toBe("https://dep.convex.site/v1/contracts/c1/approve");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk_test_abc");
      expect(JSON.parse(String(init.body))).toEqual({ termsHash: "h" });
      return { status: 200, body: { status: "review" } };
    });
    const kept = new Kept({ baseUrl: "https://dep.convex.site/", apiKey: "sk_test_abc", fetch: f });
    expect(await kept.contracts.approve("c1", "h")).toEqual({ status: "review" });
  });

  it("maps API errors and unwraps lists", async () => {
    const f = mockFetch((url) =>
      url.endsWith("/v1/contracts") ? { status: 200, body: { data: [{ _id: "c1" }] } } : { status: 409, body: { error: { code: "CONFLICT", message: "terms changed", issues: ["x"] } } },
    );
    const kept = new Kept({ baseUrl: "https://dep.convex.site", apiKey: "sk_test_abc", fetch: f });
    expect(await kept.contracts.list()).toEqual([{ _id: "c1" }]);
    const err = await kept.contracts.get("c2").catch((e) => e);
    expect(err).toBeInstanceOf(KeptApiError);
    expect(err).toMatchObject({ status: 409, code: "CONFLICT", message: "terms changed", details: { issues: ["x"] } });
  });

  it("reports timeouts", async () => {
    const f = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_r, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as unknown as typeof fetch;
    const kept = new Kept({ baseUrl: "https://dep.convex.site", apiKey: "sk_test_abc", fetch: f, timeoutMs: 20 });
    await expect(kept.me()).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("uploads a file and submits it as evidence", async () => {
    const calls: string[] = [];
    const f = mockFetch((url, init) => {
      calls.push(`${init.method} ${url}`);
      if (url.endsWith("/uploads")) return { status: 200, body: { uploadUrl: "https://dep.convex.cloud/upload/xyz" } };
      if (url.includes("/upload/xyz")) return { status: 200, body: { storageId: "st1" } };
      expect(JSON.parse(String(init.body))).toEqual({ slotId: "final_svg", storageId: "st1", fileName: "logo.svg" });
      return { status: 200, body: { evidenceId: "e1", status: "checking" } };
    });
    const kept = new Kept({ baseUrl: "https://dep.convex.site", apiKey: "sk_test_abc", fetch: f });
    const r = await kept.contracts.uploadEvidenceFile("c1", "final_svg", new Blob(["<svg/>"]), "image/svg+xml", "logo.svg");
    expect(r.evidenceId).toBe("e1");
    expect(calls).toEqual(["POST https://dep.convex.site/v1/contracts/c1/uploads", "POST https://dep.convex.cloud/upload/xyz", "POST https://dep.convex.site/v1/contracts/c1/evidence"]);
  });

  it("agent client adds an idempotency key", async () => {
    const f = mockFetch((_url, init) => {
      const body = JSON.parse(String(init.body));
      expect(body.idempotencyKey).toMatch(/[0-9a-f-]{36}/);
      expect(body.currency).toBe("USD");
      return { status: 200, body: { spendId: "s1", status: "executing" } };
    });
    const agent = new KeptAgent({ baseUrl: "https://dep.convex.site", mandateToken: "mt_abc", fetch: f });
    expect((await agent.requestSpend({ merchantEmail: "m@shop.com", merchantName: "Shop", amountCents: 100, description: "pens" })).status).toBe("executing");
  });

  it("refuses the wrong kind of credential", () => {
    expect(() => new Kept({ baseUrl: "https://x", apiKey: "mt_nope" })).toThrow();
    expect(() => new KeptAgent({ baseUrl: "https://x", mandateToken: "sk_nope" })).toThrow();
  });
});

describe("webhooks and receipts", () => {
  const secretBytes = new Uint8Array(32).map((_, i) => i + 1);
  const secret = `whsec_${btoa(String.fromCharCode(...secretBytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  const body = JSON.stringify({ type: "contract.settled", timestamp: "2026-10-31T00:00:00Z", data: { stream: "c1" } });
  const sign = (id: string, ts: string, b: string) => `v1,${btoa(String.fromCharCode(...hmacSha256(secretBytes, `${id}.${ts}.${b}`)))}`;

  it("verifies a genuine webhook and rejects tampering and replays", () => {
    const now = 1_790_000_000_000;
    const ts = String(Math.floor(now / 1000));
    const headers = { "webhook-id": "d1", "webhook-timestamp": ts, "webhook-signature": `v1,bogus ${sign("d1", ts, body)}` };
    expect(verifyWebhook({ secret, headers, body, nowMs: now }).type).toBe("contract.settled");
    expect(() => verifyWebhook({ secret, headers, body: body.replace("settled", "frozen"), nowMs: now })).toThrow(/signature/);
    expect(() => verifyWebhook({ secret, headers, body, nowMs: now + 3_600_000 })).toThrow(/timestamp/);
  });

  it("verifies signed journal entries", () => {
    const key = generateSigningKey();
    const e = sealJournalEntry({ stream: "c1", seq: 1, at: 1, actor: "system", type: "contract.created", data: { a: 1 }, prevHash: GENESIS_HASH }, key);
    expect(verifyJournalEntry(e, key.publicKeyHex)).toBe(true);
    expect(verifyJournalEntry({ ...e, data: { a: 2 } }, key.publicKeyHex)).toBe(false);
  });
});
