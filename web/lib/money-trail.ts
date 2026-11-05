import { GENESIS_HASH, journalEntryHash, verifyReceipt } from "@kept/core";
import type { JournalRow } from "./receipts";

/** Where a journal entry moved money, in the payer → PayPal hold → payee picture. */
export type Flow = "in" | "captured" | "rule" | "out" | "back" | null;

export interface TrailRow extends JournalRow {
  /** Which `data` field carries the amount (so an edit lands in the signed content). */
  amountField: string | null;
  cents: number | null;
  flow: Flow;
}

export type RowCheck = { state: "ok" } | { state: "unchecked" } | { state: "bad"; why: "content" | "signature" | "link" | "key" };

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Read the money movement out of one entry. Mirrors the backend's journal payloads. */
export function classify(row: JournalRow): TrailRow {
  const d = (row.data ?? {}) as Record<string, unknown>;
  const pick = (field: string, flow: Flow): TrailRow => ({ ...row, amountField: n(d[field]) === null ? null : field, cents: n(d[field]), flow });
  switch (row.type) {
    case "paypal.authorized":
      return pick("amountCents", "in");
    case "paypal.captured":
      // The funding capture carries the order id; later captures move already-held money.
      return pick("amountCents", d.orderId ? "in" : "captured");
    case "paypal.payout_sent":
      return pick("amountCents", "out");
    case "paypal.refunded":
    case "paypal.stray_returned":
      return pick("amountCents", "back");
    case "paypal.voided":
    case "mandate.closed":
      return pick("releasedHoldCents", "back");
    case "machine.event": {
      const moved = Array.isArray(d.transfers) ? (d.transfers as { cents?: number }[]).reduce((s, t) => s + (n(t.cents) ?? 0), 0) : 0;
      return { ...row, amountField: null, cents: moved || null, flow: moved ? "rule" : null };
    }
    default:
      return { ...row, amountField: null, cents: null, flow: null };
  }
}

/** A copy of the entry with `data[field]` replaced: the edit lands inside the signed content. */
export function withAmount(row: TrailRow, cents: number): TrailRow {
  if (!row.amountField) return row;
  return { ...row, cents, data: { ...(row.data as Record<string, unknown>), [row.amountField]: cents } };
}

/** What an attacker would do next: recompute the hash so the edited entry looks self-consistent. */
export function rehash(stream: string, row: TrailRow): TrailRow {
  return { ...row, hash: journalEntryHash({ stream, seq: row.seq, at: row.at, actor: row.actor, type: row.type, data: row.data, prevHash: row.prevHash }) };
}

/**
 * Check every entry on its own (unlike verifyChain, which stops at the first failure),
 * so an edit shows exactly which entries it breaks and why. Needs the chain from seq 1.
 */
export function checkRows(stream: string, rows: TrailRow[], keys: Record<string, string> | null, sigCache: Map<string, boolean>): RowCheck[] {
  return rows.map((r, i) => {
    if (!keys) return { state: "unchecked" };
    const prev = i === 0 ? GENESIS_HASH : rows[i - 1].hash;
    if (r.prevHash !== prev) return { state: "bad", why: "link" };
    const h = journalEntryHash({ stream, seq: r.seq, at: r.at, actor: r.actor, type: r.type, data: r.data, prevHash: r.prevHash });
    if (h !== r.hash) return { state: "bad", why: "content" };
    const pk = keys[r.keyId];
    if (!pk) return { state: "bad", why: "key" };
    const cacheKey = `${r.hash}:${r.sig}`;
    let ok = sigCache.get(cacheKey);
    if (ok === undefined) {
      ok = verifyReceipt(r.hash, r.sig, pk);
      sigCache.set(cacheKey, ok);
    }
    return ok ? { state: "ok" } : { state: "bad", why: "signature" };
  });
}

/** Money totals by direction, recomputed from the (possibly edited) entries. */
export function totals(rows: TrailRow[]) {
  const sum = (f: Flow) => rows.filter((r) => r.flow === f).reduce((s, r) => s + (r.cents ?? 0), 0);
  return { in: sum("in"), out: sum("out"), back: sum("back") };
}
