/**
 * Integrity primitives: canonical JSON, SHA-256, Ed25519 receipts,
 * per-stream hash chains and RFC 6962 Merkle trees (transparency log).
 *
 * Pure JavaScript (noble), so the same code runs in Node, browsers,
 * edge runtimes and inside Convex queries and mutations.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export { bytesToHex, hexToBytes, utf8ToBytes };

/** Deterministic JSON: sorted keys, no whitespace, undefined fields dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
      const rec = value as Record<string, unknown>;
      const keys = Object.keys(rec)
        .filter((k) => rec[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: cannot encode ${typeof value}`);
  }
}

export function sha256Hex(input: string | Uint8Array): string {
  return bytesToHex(sha256(typeof input === "string" ? utf8ToBytes(input) : input));
}

export function hmacSha256(key: Uint8Array, message: string | Uint8Array): Uint8Array {
  return hmac(sha256, key, typeof message === "string" ? utf8ToBytes(message) : message);
}

export function randomHex(bytes = 32): string {
  return bytesToHex(randomBytes(bytes));
}

// ---------------------------------------------------------------------------
// Ed25519 receipts
// ---------------------------------------------------------------------------

const RECEIPT_DOMAIN = "receipt/v1:";
const CHECKPOINT_DOMAIN = "checkpoint/v1:";

export interface SigningKey {
  secretKeyHex: string;
  publicKeyHex: string;
  keyId: string;
}

export function keyIdFor(publicKeyHex: string): string {
  return sha256Hex(hexToBytes(publicKeyHex)).slice(0, 16);
}

export function signingKeyFromSecret(secretKeyHex: string): SigningKey {
  const secret = hexToBytes(secretKeyHex.trim());
  if (secret.length !== 32) throw new Error("Ed25519 secret key must be 32 bytes (64 hex chars)");
  const publicKeyHex = bytesToHex(ed25519.getPublicKey(secret));
  return { secretKeyHex: secretKeyHex.trim(), publicKeyHex, keyId: keyIdFor(publicKeyHex) };
}

export function generateSigningKey(): SigningKey {
  return signingKeyFromSecret(bytesToHex(randomBytes(32)));
}

function signDomain(domain: string, hashHex: string, key: SigningKey): string {
  return bytesToHex(ed25519.sign(utf8ToBytes(domain + hashHex), hexToBytes(key.secretKeyHex)));
}

function verifyDomain(domain: string, hashHex: string, sigHex: string, publicKeyHex: string): boolean {
  try {
    return ed25519.verify(hexToBytes(sigHex), utf8ToBytes(domain + hashHex), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

export const signReceipt = (hashHex: string, key: SigningKey) => signDomain(RECEIPT_DOMAIN, hashHex, key);
export const verifyReceipt = (hashHex: string, sigHex: string, publicKeyHex: string) =>
  verifyDomain(RECEIPT_DOMAIN, hashHex, sigHex, publicKeyHex);
export const signCheckpoint = (hashHex: string, key: SigningKey) => signDomain(CHECKPOINT_DOMAIN, hashHex, key);
export const verifyCheckpointSignature = (hashHex: string, sigHex: string, publicKeyHex: string) =>
  verifyDomain(CHECKPOINT_DOMAIN, hashHex, sigHex, publicKeyHex);

// ---------------------------------------------------------------------------
// Hash-chained journal
// ---------------------------------------------------------------------------

export const GENESIS_HASH = "0".repeat(64);

export interface JournalEntryCore {
  stream: string;
  seq: number;
  at: number;
  actor: string;
  type: string;
  data: unknown;
  prevHash: string;
}

export interface SignedJournalEntry extends JournalEntryCore {
  hash: string;
  sig: string;
  keyId: string;
}

export function journalEntryHash(e: JournalEntryCore): string {
  return sha256Hex(
    canonicalJson({ v: 1, stream: e.stream, seq: e.seq, at: e.at, actor: e.actor, type: e.type, data: e.data, prevHash: e.prevHash }),
  );
}

export function sealJournalEntry(e: JournalEntryCore, key: SigningKey): SignedJournalEntry {
  const hash = journalEntryHash(e);
  return { ...e, hash, sig: signReceipt(hash, key), keyId: key.keyId };
}

export interface ChainCheck {
  ok: boolean;
  checked: number;
  failedAt?: number;
  reason?: string;
}

/**
 * Re-derive every hash, check the links and (optionally) every signature.
 * `publicKeys` maps keyId -> public key hex.
 */
export function verifyChain(entries: SignedJournalEntry[], publicKeys?: Record<string, string>): ChainCheck {
  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const e of entries) {
    if (e.seq !== expectedSeq) return { ok: false, checked: expectedSeq - 1, failedAt: e.seq, reason: `expected seq ${expectedSeq}` };
    if (e.prevHash !== prev) return { ok: false, checked: expectedSeq - 1, failedAt: e.seq, reason: "broken link (prevHash mismatch)" };
    const h = journalEntryHash(e);
    if (h !== e.hash) return { ok: false, checked: expectedSeq - 1, failedAt: e.seq, reason: "content does not match hash" };
    if (publicKeys) {
      const pk = publicKeys[e.keyId];
      if (!pk) return { ok: false, checked: expectedSeq - 1, failedAt: e.seq, reason: `unknown signing key ${e.keyId}` };
      if (!verifyReceipt(e.hash, e.sig, pk)) return { ok: false, checked: expectedSeq - 1, failedAt: e.seq, reason: "bad signature" };
    }
    prev = e.hash;
    expectedSeq++;
  }
  return { ok: true, checked: entries.length };
}

// ---------------------------------------------------------------------------
// RFC 6962 / RFC 9162 Merkle tree over journal entry hashes
// ---------------------------------------------------------------------------

function leafHashBytes(entryHashHex: string): Uint8Array {
  return sha256(concatBytes(new Uint8Array([0x00]), hexToBytes(entryHashHex)));
}

function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concatBytes(new Uint8Array([0x01]), left, right));
}

function largestPowerOfTwoBelow(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

function mth(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 0) return sha256(new Uint8Array());
  if (leaves.length === 1) return leaves[0];
  const k = largestPowerOfTwoBelow(leaves.length);
  return nodeHash(mth(leaves.slice(0, k)), mth(leaves.slice(k)));
}

function path(m: number, leaves: Uint8Array[]): Uint8Array[] {
  if (leaves.length <= 1) return [];
  const k = largestPowerOfTwoBelow(leaves.length);
  return m < k
    ? [...path(m, leaves.slice(0, k)), mth(leaves.slice(k))]
    : [...path(m - k, leaves.slice(k)), mth(leaves.slice(0, k))];
}

export function merkleRoot(entryHashes: string[]): string {
  return bytesToHex(mth(entryHashes.map(leafHashBytes)));
}

export function inclusionProof(entryHashes: string[], index: number): string[] {
  if (index < 0 || index >= entryHashes.length) throw new Error("inclusionProof: index out of range");
  return path(index, entryHashes.map(leafHashBytes)).map(bytesToHex);
}

/** RFC 9162 section 2.1.3.2. */
export function verifyInclusion(entryHash: string, index: number, treeSize: number, proof: string[], rootHex: string): boolean {
  if (index < 0 || index >= treeSize) return false;
  let fn = index;
  let sn = treeSize - 1;
  let r = leafHashBytes(entryHash);
  for (const pHex of proof) {
    if (sn === 0) return false;
    const p = hexToBytes(pHex);
    if ((fn & 1) === 1 || fn === sn) {
      r = nodeHash(p, r);
      if ((fn & 1) === 0) {
        while ((fn & 1) === 0 && fn !== 0) {
          fn >>= 1;
          sn >>= 1;
        }
      }
    } else {
      r = nodeHash(r, p);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && bytesToHex(r) === rootHex;
}

export interface CheckpointCore {
  seq: number;
  size: number;
  root: string;
  prevHash: string;
  at: number;
}

export function checkpointHash(c: CheckpointCore): string {
  return sha256Hex(canonicalJson({ v: 1, seq: c.seq, size: c.size, root: c.root, prevHash: c.prevHash, at: c.at }));
}
