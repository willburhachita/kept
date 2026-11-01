/**
 * Bearer secrets (invite links, API keys, agent tokens). Generated only in
 * actions, where randomness is real; only the SHA-256 is ever stored.
 */
import { sha256Hex } from "@kept/core";

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface IssuedSecret {
  /** Shown to the user exactly once. */
  token: string;
  /** Stored. */
  hash: string;
  /** Safe to display later ("sk_test_AbC1…"). */
  prefix: string;
}

export function issueSecret(kind: "sk" | "mt" | "inv" | "whsec", bytes = 32): IssuedSecret {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  const body = base64url(raw);
  const head = kind === "sk" ? `sk_${process.env.PAYPAL_ENV === "live" ? "live" : "test"}_` : `${kind}_`;
  const token = head + body;
  return { token, hash: hashSecret(token), prefix: `${head}${body.slice(0, 6)}…` };
}

export function hashSecret(token: string): string {
  return sha256Hex(token.trim());
}

/** Extract a bearer token from an Authorization header. */
export function bearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m ? m[1] : null;
}
