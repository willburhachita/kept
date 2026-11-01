"use client";

import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { site } from "@/lib/site";

/**
 * Look-alike protection: if this app is served from any host other than the
 * official one (a cloned phishing site), say so loudly before anyone types a
 * password or follows a payment link.
 */
export function PhishingGuard() {
  const [host, setHost] = useState<string | null>(null);
  useEffect(() => {
    const h = window.location.hostname;
    const official = site.officialHost.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const local = h === "localhost" || h === "127.0.0.1" || h.endsWith(".localhost");
    if (official && !local && h !== official) setHost(h);
  }, []);
  if (!host) return null;
  return (
    <div role="alert" className="sticky top-0 z-[70] flex items-center justify-center gap-2 bg-bad px-4 py-2.5 text-center text-sm text-white">
      <ShieldAlert className="size-4 shrink-0" />
      <span>
        You are on <strong className="font-semibold">{host}</strong>, not the official Kept site ({site.officialHost}). Don&apos;t sign in or pay here.
      </span>
    </div>
  );
}
