/**
 * Environment configuration. Set with `npx convex env set NAME value`.
 * Never return any of these values to clients.
 */
import { DEFAULT_FEE_BPS, signingKeyFromSecret, type SigningKey } from "@kept/core";
import { fail } from "./errors";

export type RailName = "paypal" | "sim";

export const env = {
  /** Public URL of the frontend (PayPal return URLs, invite links). */
  siteUrl(): string {
    return (process.env.SITE_URL ?? "http://localhost:5173").replace(/\/+$/, "");
  },
  /** Public URL of this deployment's HTTP actions (provided by Convex). */
  convexSiteUrl(): string {
    return (process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
  },
  feeBps(): number {
    const raw = process.env.FEE_BPS;
    const n = raw === undefined ? DEFAULT_FEE_BPS : Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 2000 ? n : DEFAULT_FEE_BPS;
  },
  /** "paypal" (default) or "sim" (deterministic local rail for tests and offline demos). */
  rail(): RailName {
    return process.env.PAYMENT_RAIL === "sim" ? "sim" : "paypal";
  },
  paypal() {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) fail("CONFIG_MISSING", "PayPal is not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET).");
    const live = process.env.PAYPAL_ENV === "live";
    return {
      clientId,
      clientSecret,
      baseUrl: live ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
      webhookId: process.env.PAYPAL_WEBHOOK_ID ?? null,
      live,
    };
  },
  /** Channel3 product search for agent budgets (optional). */
  channel3Key(): string | null {
    return process.env.CHANNEL3_API_KEY ?? null;
  },
  anthropicKey(): string | null {
    return process.env.ANTHROPIC_API_KEY ?? null;
  },
  /** Model for every AI step. */
  model(): string {
    return process.env.AI_MODEL ?? "claude-opus-5-5";
  },
  brandName(): string {
    return process.env.BRAND_NAME ?? "Kept";
  },
};

let cachedKey: { secret: string; key: SigningKey } | null = null;

/** Ed25519 key that signs every journal entry and checkpoint. */
export function signingKey(): SigningKey {
  const secret = process.env.RECEIPT_SIGNING_KEY;
  if (!secret) fail("CONFIG_MISSING", "RECEIPT_SIGNING_KEY is not set. Run `npm run setup:keys` in backend/.");
  if (cachedKey?.secret !== secret) cachedKey = { secret, key: signingKeyFromSecret(secret) };
  return cachedKey.key;
}
