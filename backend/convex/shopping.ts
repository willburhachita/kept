/**
 * Policy-aware product search for agent budgets.
 *
 * The budget is compiled into the search itself (price ceiling, retailers), then every
 * returned offer is run through the same guard a real purchase meets. An agent only
 * sees what it could actually buy, ready to pass to request_spend; everything else is
 * hidden and counted by reason. The owner's preview shows the hidden ones too.
 */
import { formatCents, type MandatePolicy, type SpendDecision } from "@kept/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { guard } from "./agentApi";
import { requireUserId } from "./lib/authz";
import { searchProducts, type Channel3Filters } from "./lib/channel3";
import { fail } from "./lib/errors";
import { LIMITS, rateLimit } from "./lib/rateLimit";

const MAX_RESULTS = 30;

type Context = { mandateId: Id<"mandates">; policy: MandatePolicy; status: string; remainingCents: number };
type Verdict = { key: string; decision: SpendDecision; reasons: string[]; feeCents: number };
export interface ScreenedOffer {
  title: string;
  brand: string | null;
  image: string | null;
  retailer: string;
  url: string;
  price: string;
  amountCents: number;
  decision: "allowed" | "needs_approval" | "blocked";
  reasons: string[];
  feeCents: number;
  purchase: { merchantEmail: string; merchantName: string; amountCents: number; currency: string; description: string };
}
export interface SearchResult {
  query: string;
  searchedWith: { maxPrice: string; retailers: string[] | "any"; currency: string };
  results: ScreenedOffer[];
  hidden: { count: number; reasons: Record<string, number>; items?: ScreenedOffer[] };
  note: string;
}

/** The budget as Channel3 filters: nothing above what one purchase may cost, only allowed retailers. */
export function searchFiltersFor(policy: MandatePolicy, remainingCents: number): Channel3Filters {
  const ceiling = Math.min(policy.perPurchaseMaxCents, remainingCents);
  const domains = [...new Set(policy.allowedMerchants.map((m) => (m.startsWith("@") ? m.slice(1) : (m.split("@")[1] ?? ""))).filter(Boolean))];
  return {
    price: { max_price: Math.max(0, ceiling) / 100 },
    availability: ["InStock"],
    conditions: ["new"],
    ...(domains.length ? { website_ids: domains } : {}),
  };
}

/**
 * Who gets paid for an offer from `domain`. An allowlisted PayPal email on that domain wins.
 * Otherwise the retailer's sandbox stand-in address, which the allowlist still checks by domain.
 */
export function payeeFor(policy: MandatePolicy, domain: string): string {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return policy.allowedMerchants.find((m) => !m.startsWith("@") && m.split("@")[1] === d) ?? `paypal@${d}`;
}

const candidateV = v.object({
  key: v.string(),
  amountCents: v.number(),
  currency: v.string(),
  merchantEmail: v.string(),
  description: v.string(),
});

/** The mandate a caller may search for: by agent token, or by its owner. */
export const _context = internalQuery({
  args: { tokenHash: v.optional(v.string()), userId: v.optional(v.id("users")), mandateId: v.optional(v.id("mandates")) },
  handler: async (ctx, a): Promise<Context | null> => {
    let mandateId: Id<"mandates"> | null = null;
    if (a.tokenHash) {
      const t = await ctx.db
        .query("agentTokens")
        .withIndex("by_hash", (q) => q.eq("tokenHash", a.tokenHash!))
        .unique();
      if (t && !t.revokedAt && t.expiresAt > Date.now()) mandateId = t.mandateId;
    } else if (a.userId && a.mandateId) {
      const m = await ctx.db.get(a.mandateId);
      if (m && m.ownerId === a.userId) mandateId = m._id;
    }
    const m = mandateId ? await ctx.db.get(mandateId) : null;
    if (!m) return null;
    return { mandateId: m._id, policy: m.policy as MandatePolicy, status: m.status, remainingCents: Math.max(0, m.policy.budgetCents - m.spentCents - m.reservedCents) };
  },
});

/** Run each candidate through the purchase guard as the mandate stands now. */
export const _screen = internalQuery({
  args: { mandateId: v.id("mandates"), candidates: v.array(candidateV) },
  handler: async (ctx, { mandateId, candidates }): Promise<Verdict[]> => {
    const m = await ctx.db.get(mandateId);
    if (!m) return [];
    const now = Date.now();
    const out: Verdict[] = [];
    for (const c of candidates) {
      const ev = await guard(ctx, m, { amountCents: c.amountCents, currency: c.currency, merchantEmail: c.merchantEmail, description: c.description }, now);
      out.push({ key: c.key, decision: ev.decision, reasons: ev.reasons, feeCents: ev.feeCents });
    }
    return out;
  },
});

export const _limit = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => rateLimit(ctx, key, LIMITS.productSearch),
});

type Who = { tokenHash: string } | { userId: Id<"users">; mandateId: Id<"mandates"> };

async function screenedSearch(ctx: ActionCtx, who: Who, rawQuery: string, rawLimit: unknown, includeHidden: boolean): Promise<SearchResult> {
  const query = rawQuery.trim().slice(0, 200);
  if (!query) fail("INVALID_ARGUMENT", "Say what to look for.");
  const limit = Math.min(MAX_RESULTS, Math.max(1, Number.isInteger(rawLimit) ? (rawLimit as number) : 12));
  const m: Context | null = await ctx.runQuery(internal.shopping._context, who);
  if (!m) fail("UNAUTHENTICATED", "Invalid, revoked or expired mandate token.");
  await ctx.runMutation(internal.shopping._limit, { key: `products:${m.mandateId}` });
  const p: MandatePolicy = m.policy;
  const filters = searchFiltersFor(p, m.remainingCents);
  const products = await searchProducts(query, { limit, currency: p.currency, filters });

  // One row per offer: the same product from two retailers is two different purchases.
  const rows = products.flatMap((prod) =>
    (prod.offers ?? []).map((o, i) => {
      const domain = o.domain.toLowerCase().replace(/^www\./, "");
      const amountCents = Math.round(o.price.price * 100);
      const image = prod.images?.find((x) => x.is_main_image) ?? prod.images?.[0];
      return {
        key: `${prod.id}:${i}`,
        productId: prod.id,
        title: prod.title,
        brand: prod.brands?.[0]?.name ?? null,
        image: image?.cleaned_url || image?.url || null,
        retailer: domain,
        url: o.url,
        currency: o.price.currency.toUpperCase(),
        amountCents,
        merchantEmail: payeeFor(p, domain),
      };
    }),
  );
  const verdicts: Verdict[] = await ctx.runQuery(internal.shopping._screen, {
    mandateId: m.mandateId,
    candidates: rows.map((r) => ({ key: r.key, amountCents: r.amountCents, currency: r.currency, merchantEmail: r.merchantEmail, description: r.title.slice(0, 500) })),
  });
  const byKey = new Map(verdicts.map((x) => [x.key, x]));

  const visible: ScreenedOffer[] = [];
  const hidden: ScreenedOffer[] = [];
  for (const r of rows) {
    const ev = byKey.get(r.key);
    if (!ev) continue;
    const item: ScreenedOffer = {
      title: r.title,
      brand: r.brand,
      image: r.image,
      retailer: r.retailer,
      url: r.url,
      price: formatCents(r.amountCents, p.currency),
      amountCents: r.amountCents,
      decision: ev.decision === "approve" ? "allowed" : ev.decision === "needs_approval" ? "needs_approval" : "blocked",
      reasons: ev.reasons,
      feeCents: ev.feeCents,
      // Ready to pass to request_spend / POST /agent/v1/spends.
      purchase: { merchantEmail: r.merchantEmail, merchantName: r.retailer, amountCents: r.amountCents, currency: r.currency, description: r.title.slice(0, 500) },
    };
    (item.decision === "blocked" ? hidden : visible).push(item);
  }
  // Cheapest first among what can be bought; anything needing approval after what can't wait.
  visible.sort((a, b) => (a.decision === b.decision ? a.amountCents - b.amountCents : a.decision === "allowed" ? -1 : 1));
  const hiddenReasons: Record<string, number> = {};
  for (const h of hidden) for (const why of h.reasons) hiddenReasons[why] = (hiddenReasons[why] ?? 0) + 1;

  return {
    query,
    searchedWith: {
      maxPrice: formatCents(Math.round((filters.price?.max_price ?? 0) * 100), p.currency),
      retailers: filters.website_ids ?? "any",
      currency: p.currency,
    },
    results: visible,
    hidden: { count: hidden.length, reasons: hiddenReasons, ...(includeHidden ? { items: hidden } : {}) },
    note:
      "Prices and stock come from Channel3 at search time. In sandbox, Kept pays the retailer's PayPal stand-in address; the decision is re-checked when you call request_spend.",
  };
}

/** For agents (REST and MCP): only what the budget allows is returned. */
export async function agentProductSearch(ctx: ActionCtx, tokenHash: string, query: string, limit: unknown): Promise<SearchResult> {
  return screenedSearch(ctx, { tokenHash }, query, limit, false);
}

/** For the owner: see exactly what the agent would see, plus what it wouldn't and why. */
export const preview = action({
  args: { mandateId: v.id("mandates"), query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { mandateId, query, limit }): Promise<SearchResult> => screenedSearch(ctx, { userId: await requireUserId(ctx), mandateId }, query, limit, true),
});
