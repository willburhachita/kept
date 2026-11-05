/**
 * Channel3 product search (https://channel3.ai/docs/api-reference/v1/search).
 * Agents find products here; Kept decides what they may buy.
 */
import { env } from "./env";
import { fail } from "./errors";

const BASE_URL = "https://api.trychannel3.com";

export interface Channel3Filters {
  website_ids?: string[];
  price?: { min_price?: number | null; max_price?: number | null };
  availability?: ("InStock" | "OutOfStock")[];
  conditions?: ("new" | "used")[];
}

export interface Channel3Offer {
  url: string;
  domain: string;
  price: { price: number; compare_at_price?: number | null; currency: string };
  availability: "InStock" | "OutOfStock";
}

export interface Channel3Product {
  id: string;
  title: string;
  brands?: { id: string; name: string }[];
  images?: { url: string; cleaned_url?: string | null; is_main_image?: boolean }[];
  offers?: Channel3Offer[];
}

export async function searchProducts(query: string, opts: { limit: number; currency: string; filters: Channel3Filters }): Promise<Channel3Product[]> {
  const key = env.channel3Key();
  if (!key) fail("CONFIG_MISSING", "Product search isn't switched on for this deployment (CHANNEL3_API_KEY).");
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/v1/search`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ query, limit: opts.limit, filters: opts.filters, config: { currency: opts.currency } }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    fail("INVALID_STATE", "Product search didn't answer in time. Try again.");
  }
  if (res.status === 401 || res.status === 403) fail("CONFIG_MISSING", "Channel3 rejected the API key.");
  if (res.status === 402) fail("RATE_LIMITED", "Product search is out of credits for this month.");
  if (res.status === 429) fail("RATE_LIMITED", "Product search is busy. Try again in a minute.");
  if (!res.ok) fail("INVALID_STATE", `Product search failed (HTTP ${res.status}).`);
  const body = (await res.json()) as { products?: Channel3Product[] };
  return Array.isArray(body.products) ? body.products : [];
}
