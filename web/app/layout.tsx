import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PhishingGuard } from "@/components/site/phishing-guard";
import { site } from "@/lib/site";
import { Providers } from "./providers";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: "Kept: every promise, kept.", template: "%s · Kept" },
  description:
    "Write a deal in plain English. Kept proves the payment rules can't break a promise, holds the money on PayPal, and releases it only when the promise is kept.",
  openGraph: {
    title: "Kept: every promise, kept.",
    description: "Payment promises proved before anyone pays, held on PayPal, released only when kept.",
    type: "website",
  },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#f5f5f5",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <Providers>
          <PhishingGuard />
          {children}
        </Providers>
      </body>
    </html>
  );
}
