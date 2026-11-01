import { verifyChain, type ChainCheck, type SignedJournalEntry } from "@kept/core";
import { site } from "./site";

export interface PublicKey {
  keyId: string;
  alg: string;
  publicKey: string;
  use: string[];
}

/** Fetch Kept's published Ed25519 keys (keyId -> public key hex). */
export async function fetchPublicKeys(url: string = site.keysUrl): Promise<Record<string, string>> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Couldn't load the public keys (HTTP ${res.status}).`);
  const body = (await res.json()) as { keys?: PublicKey[] };
  const out: Record<string, string> = {};
  for (const k of body.keys ?? []) if (k.alg === "Ed25519" && /^[0-9a-f]{64}$/i.test(k.publicKey)) out[k.keyId] = k.publicKey;
  if (!Object.keys(out).length) throw new Error("The key file contains no Ed25519 keys.");
  return out;
}

/** The fields `contracts.journal` returns for each entry. */
export interface JournalRow {
  seq: number;
  at: number;
  actor: string;
  type: string;
  data: unknown;
  hash: string;
  prevHash: string;
  sig: string;
  keyId: string;
}

export interface JournalVerification extends ChainCheck {
  /** seq -> verified (true), failed (false). Entries after a failure are unverified (absent). */
  perEntry: Record<number, boolean>;
  keyIds: string[];
}

/**
 * Independently re-check a contract's receipts in the browser: recompute every
 * hash, follow every prevHash link from genesis, and verify every Ed25519
 * signature against the published keys. Needs the chain from seq 1.
 */
export function verifyJournal(stream: string, rows: JournalRow[], keys: Record<string, string>): JournalVerification {
  const entries: SignedJournalEntry[] = rows.map((r) => ({ stream, seq: r.seq, at: r.at, actor: r.actor, type: r.type, data: r.data, prevHash: r.prevHash, hash: r.hash, sig: r.sig, keyId: r.keyId }));
  const res = verifyChain(entries, keys);
  const perEntry: Record<number, boolean> = {};
  for (const e of entries) {
    if (res.ok || (res.failedAt !== undefined && e.seq < res.failedAt)) perEntry[e.seq] = true;
    else if (e.seq === res.failedAt) perEntry[e.seq] = false;
  }
  return { ...res, perEntry, keyIds: [...new Set(entries.map((e) => e.keyId))] };
}
