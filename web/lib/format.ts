import { formatCents, type Currency } from "@kept/core";

export { formatCents };

/** Money in the API's currency. Prefer the formatted strings the API returns when they exist. */
export function money(cents: number | null | undefined, currency: string = "USD"): string {
  if (cents === null || cents === undefined) return "—";
  return formatCents(cents, currency as Currency);
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** 3d 4h, 5h 12m, 42s. */
export function duration(ms: number, parts = 2): string {
  const abs = Math.max(0, Math.abs(ms));
  if (abs < MIN) return `${Math.ceil(abs / 1000)}s`;
  const units: [number, string][] = [
    [DAY, "d"],
    [HOUR, "h"],
    [MIN, "m"],
  ];
  const out: string[] = [];
  let rest = abs;
  for (const [size, label] of units) {
    const n = Math.floor(rest / size);
    if (n > 0 || out.length) {
      if (n > 0) out.push(`${n}${label}`);
      rest -= n * size;
    }
    if (out.length >= parts) break;
  }
  return out.join(" ") || "0m";
}

/** "in 3d 4h" / "2h 5m ago" relative to now. */
export function relative(at: number, now: number = Date.now()): string {
  const d = at - now;
  if (Math.abs(d) < 45_000) return "just now";
  return d > 0 ? `in ${duration(d)}` : `${duration(-d)} ago`;
}

/** Fri 14 Nov, 16:30. */
export function dateTime(at: number): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(at);
}

/** 14 Nov 2026. */
export function dateOnly(at: number): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(at);
}

/** a1b2c3d4 → "a1b2 c3d4" (first `chars` hex characters, grouped for reading aloud). */
export function fingerprint(hash: string | null | undefined, chars = 8): string {
  if (!hash) return "—";
  return (hash.slice(0, chars).match(/.{1,4}/g) ?? []).join(" ");
}

export function shortHash(hash: string | null | undefined, chars = 10): string {
  if (!hash) return "—";
  return hash.length > chars ? `${hash.slice(0, chars)}…` : hash;
}

export function pct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}
