const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://befitting-mosquito-713.convex.cloud";
const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? convexUrl.replace(/\.convex\.cloud$/, ".convex.site");
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;

/** Public configuration. Everything here is safe to ship to the browser. */
export const site = {
  name: "Kept",
  tagline: "Every promise, kept.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? (vercelHost ? `https://${vercelHost}` : "http://localhost:3000"),
  convexUrl,
  convexSiteUrl,
  /** REST API (API keys), see /docs/api. */
  apiBase: `${convexSiteUrl}/v1`,
  /** Remote MCP endpoint for AI agents (mandate tokens). */
  mcpUrl: `${convexSiteUrl}/mcp`,
  agentApiBase: `${convexSiteUrl}/agent/v1`,
  /** Ed25519 keys that sign every journal entry and checkpoint. */
  keysUrl: `${convexSiteUrl}/.well-known/kept-keys.json`,
  healthUrl: `${convexSiteUrl}/health`,
  /** If set, visitors on any other host get a phishing warning. */
  officialHost: process.env.NEXT_PUBLIC_OFFICIAL_HOST ?? "",
  github: "https://github.com/willburhachita/kept",
  npm: { core: "@kept/core", sdk: "@kept/sdk", mcp: "@kept/mcp" },
} as const;

/** Unsplash photography (free licence), hotlinked with sizing params. */
export function photo(id: string, w = 1200, h?: number): string {
  const size = h ? `&h=${h}&fit=crop` : "";
  return `https://images.unsplash.com/${id}?auto=format&q=72&w=${w}${size}`;
}

export const PHOTOS = {
  freelancerLaptop: "photo-1612299273045-362a39972259",
  freelancerTable: "photo-1657449036184-4fb912035102",
  freelancerHand: "photo-1694175271713-a6e2cc378980",
  womanBench: "photo-1765650114546-83a73ec9d461",
  womanDesk: "photo-1610473199899-fc0ec6e204bb",
  womanFolder: "photo-1765650114537-423a387b4520",
  plumberBathroom: "photo-1749532125405-70950966b0e5",
  plumberPipe: "photo-1676210134188-4c05dd172f89",
  plumberHeater: "photo-1676210134190-3f2c0d5cf58d",
  fruitStandPhone: "photo-1687422809654-579d81c29d32",
  womanSmiling: "photo-1573496799515-eebbb63814f2",
  womanBlazer: "photo-1563132337-f159f484226c",
} as const;

/** Official PayPal marks (served by PayPal for merchants that accept PayPal). */
export const PAYPAL_LOGO = {
  full: "https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-color.svg",
  mark: "https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-mark-color.svg",
  wordmark: "https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-wordmark-color.svg",
} as const;
