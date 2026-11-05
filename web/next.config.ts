import path from "node:path";
import type { NextConfig } from "next";

// The app imports the Convex API types from ../backend and @kept/core from ../packages.
const root = path.join(process.cwd(), "..");
const dev = process.env.NODE_ENV !== "production";

// Strict-ish CSP: the app talks only to Convex, scripts are first-party,
// and it can never be framed (clickjacking and look-alike overlay scams).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Any https image: agent shopping shows product photos from whichever retailer CDN Channel3 returns.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.convex.cloud wss://*.convex.cloud https://*.convex.site",
  "media-src 'self' https://*.convex.cloud",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const config: NextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root,
  images: {
    // Our photos ship in the repo (assets/photos); serve them as AVIF/WebP and cache for a year.
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 31_536_000,
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "www.paypalobjects.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default config;
