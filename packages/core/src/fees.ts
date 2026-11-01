/**
 * Money math. Everything is integer minor units (cents); there are no floats
 * anywhere on the money path.
 *
 * Fee model: the funder authorizes principal + the maximum possible fee.
 * The fee is earned only on money actually released to the payee, computed
 * on the cumulative released total so rounding never drifts:
 *   fee(released) = ceil(released * feeBps / 10_000)
 * Unused fee reserve goes back to the funder at settlement.
 */
import type { Currency } from "./ir.js";

export const DEFAULT_FEE_BPS = 250;

function ceilDiv(a: number, b: number): number {
  return Math.floor((a + b - 1) / b);
}

export function feeOnCumulative(releasedCents: number, feeBps: number): number {
  assertCents(releasedCents);
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 2000) throw new Error("feeBps must be an integer between 0 and 2000");
  return ceilDiv(releasedCents * feeBps, 10_000);
}

/** Fee owed for releasing `amount` when `releasedBefore` was already released. */
export function feeForRelease(releasedBefore: number, amount: number, feeBps: number): number {
  return feeOnCumulative(releasedBefore + amount, feeBps) - feeOnCumulative(releasedBefore, feeBps);
}

export function maxFee(principalCents: number, feeBps: number): number {
  return feeOnCumulative(principalCents, feeBps);
}

/** What the funder authorizes (or pays into escrow) up front. */
export function authorizationAmount(principalCents: number, feeBps: number): number {
  return principalCents + maxFee(principalCents, feeBps);
}

export function assertCents(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`invalid cents amount: ${n}`);
}

const SYMBOLS: Record<Currency, string> = { USD: "$", EUR: "€", GBP: "£", CAD: "CA$", AUD: "A$" };

export function formatCents(cents: number, currency: Currency = "USD"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}${SYMBOLS[currency] ?? ""}${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** 12345 -> "123.45" (PayPal amount.value format). */
export function centsToDecimalString(cents: number): string {
  assertCents(cents);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** "123.45" -> 12345. Strict: rejects anything that is not a plain 2-decimal amount. */
export function decimalStringToCents(value: string): number {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new Error(`invalid decimal amount: ${value}`);
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}
