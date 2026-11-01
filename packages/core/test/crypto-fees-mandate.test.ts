import { describe, expect, it } from "vitest";
import {
  GENESIS_HASH,
  authorizationAmount,
  canonicalJson,
  centsToDecimalString,
  checkpointHash,
  decimalStringToCents,
  evaluateSpend,
  feeForRelease,
  feeOnCumulative,
  generateSigningKey,
  inclusionProof,
  merkleRoot,
  officeSuppliesMandate,
  sealJournalEntry,
  sha256Hex,
  signCheckpoint,
  signReceipt,
  signingKeyFromSecret,
  validateMandate,
  verifyChain,
  verifyCheckpointSignature,
  verifyInclusion,
  verifyMandate,
  verifyReceipt,
  type MandateRuntime,
  type SignedJournalEntry,
} from "../src/index.js";

describe("canonical JSON and hashing", () => {
  it("sorts keys and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"], c: undefined })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
  });
  it("sha256 matches a known vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("receipts and hash chains", () => {
  const key = generateSigningKey();

  it("signs and verifies, and rejects tampering", () => {
    const h = sha256Hex("entry");
    const sig = signReceipt(h, key);
    expect(verifyReceipt(h, sig, key.publicKeyHex)).toBe(true);
    expect(verifyReceipt(sha256Hex("other"), sig, key.publicKeyHex)).toBe(false);
    expect(signingKeyFromSecret(key.secretKeyHex).publicKeyHex).toBe(key.publicKeyHex);
    // receipts and checkpoints use different domains
    expect(verifyCheckpointSignature(h, sig, key.publicKeyHex)).toBe(false);
  });

  it("detects edits, reordering and forged signatures", () => {
    const entries: SignedJournalEntry[] = [];
    let prev = GENESIS_HASH;
    for (let seq = 1; seq <= 5; seq++) {
      const e = sealJournalEntry({ stream: "c1", seq, at: 1000 + seq, actor: "system", type: "t", data: { seq }, prevHash: prev }, key);
      entries.push(e);
      prev = e.hash;
    }
    const keys = { [key.keyId]: key.publicKeyHex };
    expect(verifyChain(entries, keys)).toEqual({ ok: true, checked: 5 });
    const edited = entries.map((e) => ({ ...e }));
    edited[2] = { ...edited[2], data: { seq: 99 } };
    expect(verifyChain(edited, keys).failedAt).toBe(3);
    const swapped = [entries[0], entries[2], entries[1], entries[3], entries[4]];
    expect(verifyChain(swapped, keys).ok).toBe(false);
    const other = generateSigningKey();
    expect(verifyChain(entries, { [key.keyId]: other.publicKeyHex }).reason).toBe("bad signature");
  });
});

describe("RFC 6962 Merkle tree", () => {
  it("every inclusion proof verifies for trees of size 1..33", () => {
    for (let n = 1; n <= 33; n++) {
      const leaves = Array.from({ length: n }, (_, i) => sha256Hex(`leaf-${i}`));
      const root = merkleRoot(leaves);
      for (let i = 0; i < n; i++) {
        const proof = inclusionProof(leaves, i);
        expect(verifyInclusion(leaves[i], i, n, proof, root)).toBe(true);
        expect(verifyInclusion(sha256Hex("forged"), i, n, proof, root)).toBe(false);
        if (n > 1) expect(verifyInclusion(leaves[i], (i + 1) % n, n, proof, root)).toBe(false);
      }
    }
  });

  it("signs checkpoints", () => {
    const key = generateSigningKey();
    const cp = { seq: 1, size: 3, root: merkleRoot(["a", "b", "c"].map((x) => sha256Hex(x))), prevHash: GENESIS_HASH, at: 1 };
    const h = checkpointHash(cp);
    expect(verifyCheckpointSignature(h, signCheckpoint(h, key), key.publicKeyHex)).toBe(true);
  });
});

describe("fees", () => {
  it("cumulative fees never drift and never exceed the reserve", () => {
    const bps = 250;
    let released = 0;
    let fees = 0;
    for (const amt of [333, 1, 9_999, 7, 12_345, 7_315]) {
      fees += feeForRelease(released, amt, bps);
      released += amt;
      expect(fees).toBe(feeOnCumulative(released, bps));
    }
    expect(fees).toBeLessThanOrEqual(authorizationAmount(released, bps) - released);
  });

  it("converts PayPal decimal strings strictly", () => {
    expect(centsToDecimalString(30_750)).toBe("307.50");
    expect(decimalStringToCents("307.5")).toBe(30_750);
    expect(decimalStringToCents("0.07")).toBe(7);
    expect(() => decimalStringToCents("1e3")).toThrow();
    expect(() => decimalStringToCents("-1.00")).toThrow();
  });
});

describe("mandates", () => {
  const policy = officeSuppliesMandate;
  const rt = (over: Partial<MandateRuntime> = {}): MandateRuntime => ({
    status: "active",
    activatedAt: 0,
    spentCents: 0,
    reservedCents: 0,
    purchases: 0,
    recentSpendTimes: [],
    ...over,
  });
  const req = (amountCents: number, merchantEmail = "desk@supplies.example.com") => ({
    amountCents,
    currency: "USD",
    merchantEmail,
    description: "printer paper",
  });

  it("validates the example policy", () => {
    expect(validateMandate(policy).ok).toBe(true);
    expect(validateMandate({ ...policy, allowedMerchants: ["not an email"] }).ok).toBe(false);
  });

  it("approves, escalates and denies", () => {
    expect(evaluateSpend(policy, rt(), req(2_500), 1000, 250).decision).toBe("approve");
    expect(evaluateSpend(policy, rt(), req(4_000), 1000, 250).decision).toBe("needs_approval");
    expect(evaluateSpend(policy, rt(), req(6_000), 1000, 250).decision).toBe("deny");
    expect(evaluateSpend(policy, rt(), req(1_000, "x@evil.example"), 1000, 250).reasons.join()).toMatch(/allowlist/);
    expect(evaluateSpend(policy, rt({ spentCents: 19_000 }), req(2_000), 1000, 250).reasons.join()).toMatch(/remaining budget/);
    expect(evaluateSpend(policy, rt(), req(1_000), 169 * 3_600_000, 250).reasons.join()).toMatch(/expired/);
  });

  it("proves the caps under a hostile simulation", () => {
    const r = verifyMandate(policy, 250);
    expect(r.ok).toBe(true);
    expect(r.authorizationCents).toBe(20_000 + 500);
  });
});
