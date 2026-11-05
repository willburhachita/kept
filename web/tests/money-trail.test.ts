/**
 * The money trail's tamper test: editing a signed entry must be caught at that entry,
 * re-hashing it must still be caught (signature), and every later entry must show the
 * broken link. Uses a real Ed25519-signed chain.
 */
import { GENESIS_HASH, generateSigningKey, sealJournalEntry, type SignedJournalEntry } from "@kept/core";
import { describe, expect, it } from "vitest";
import { checkRows, classify, rehash, totals, withAmount } from "@/lib/money-trail";

const key = generateSigningKey();
const keys = { [key.keyId]: key.publicKeyHex };
const stream = "contract-1";

function chain(): SignedJournalEntry[] {
  const events: [string, string, unknown][] = [
    ["system", "contract.created", { title: "Logo" }],
    ["paypal", "paypal.authorized", { amountCents: 30750, orderId: "O-1" }],
    ["paypal", "paypal.payout_sent", { amountCents: 10000, receiver: "d***@x.com" }],
    ["paypal", "paypal.payout_sent", { amountCents: 20000, receiver: "d***@x.com" }],
  ];
  const out: SignedJournalEntry[] = [];
  let prev = GENESIS_HASH;
  events.forEach(([actor, type, data], i) => {
    const e = sealJournalEntry({ stream, seq: i + 1, at: 1_700_000_000_000 + i, actor, type, data, prevHash: prev }, key);
    out.push(e);
    prev = e.hash;
  });
  return out;
}

const rows = () => chain().map((e) => classify(e));
const states = (r: ReturnType<typeof checkRows>) => r.map((c) => (c.state === "bad" ? c.why : c.state));

describe("money trail tamper checks", () => {
  it("verifies an untouched chain", () => {
    expect(states(checkRows(stream, rows(), keys, new Map()))).toEqual(["ok", "ok", "ok", "ok"]);
  });

  it("catches an edited amount at that entry and breaks nothing before it", () => {
    const r = rows();
    r[2] = withAmount(r[2], 1_000_000);
    expect(states(checkRows(stream, r, keys, new Map()))).toEqual(["ok", "ok", "content", "ok"]);
  });

  it("still catches it after re-hashing: the signature fails and the next link breaks", () => {
    const r = rows();
    r[2] = rehash(stream, withAmount(r[2], 1_000_000));
    expect(states(checkRows(stream, r, keys, new Map()))).toEqual(["ok", "ok", "signature", "link"]);
  });

  it("reports unchecked until the published key is loaded", () => {
    expect(states(checkRows(stream, rows(), null, new Map()))).toEqual(["unchecked", "unchecked", "unchecked", "unchecked"]);
  });

  it("recomputes totals from the edited rows", () => {
    const r = rows();
    expect(totals(r)).toEqual({ in: 30750, out: 30000, back: 0 });
    r[3] = withAmount(r[3], 25000);
    expect(totals(r).out).toBe(35000);
  });
});
