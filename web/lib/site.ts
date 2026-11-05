import womanDeskImg from "@/assets/photos/designer-desk.jpg";
import womanBenchImg from "@/assets/photos/freelancer-bench.jpg";
import fruitStandPhoneImg from "@/assets/photos/hero-market.jpg";
import plumberBathroomImg from "@/assets/photos/plumber-bathroom.jpg";
import womanFolderImg from "@/assets/photos/woman-folder.jpg";

const convexUrl =process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://befitting-mosquito-713.convex.cloud";
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

/**
 * Unsplash photography (free licence), stored in the repo so it is served from our own CDN,
 * resized per screen with a blurred preview (see components/ui/photo.tsx). Hotlinking the
 * originals was slow on mobile networks.
 */
export const PHOTOS = {
  womanBench: womanBenchImg,
  womanDesk: womanDeskImg,
  womanFolder: womanFolderImg,
  plumberBathroom: plumberBathroomImg,
  fruitStandPhone: fruitStandPhoneImg,
} as const;

/** Official PayPal marks (served by PayPal for merchants that accept PayPal). */
export const PAYPAL_LOGO = {
  full: "https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-color.svg",
  mark: "https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-mark-color.svg",
  wordmark: "https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-wordmark-color.svg",
} as const;
