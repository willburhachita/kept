import { ArrowRight, Lock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { LinkCheck } from "@/components/landing/link-check";
import { Button } from "@/components/ui/button";
import { site } from "@/lib/site";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#how", label: "How it works" },
      { href: "/#safety", label: "Scam protection" },
      { href: "/#agents", label: "Agent budgets" },
      { href: "/#pricing", label: "Pricing" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/docs/quickstart", label: "Quickstart" },
      { href: "/docs/api", label: "REST API" },
      { href: "/docs/mcp", label: "MCP for agents" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/verify", label: "Verify a contract" },
      { href: "/docs/scam-protection", label: "Safety guide" },
      { href: "/docs/security", label: "Security model" },
      { href: site.keysUrl, label: "Public signing keys" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="bg-ink px-5 pb-10 pt-28 text-white sm:pt-40">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-14 lg:grid-cols-[1.25fr_1fr] lg:gap-20">
          <div className="flex flex-col">
            <h2 className="text-[clamp(3.5rem,10vw,8.5rem)] font-semibold leading-[0.9] tracking-[-0.065em]">
              Make a
              <br />
              promise.
            </h2>
            <p className="mt-8 max-w-md text-lg leading-snug tracking-[-0.03em] text-white/60">
              <span className="text-white">Plain English in, proved terms out</span> &mdash; held on PayPal, released only when it&apos;s kept.
            </p>
            <div className="mt-8">
              <Button href="/signin?mode=signUp" variant="inverse" size="lg" iconRight={<ArrowRight className="size-4" />}>
                Start free
              </Button>
            </div>
            <div className="mt-auto grid gap-6 pt-14 sm:grid-cols-2">
              <div>
                <p className="flex items-center gap-2 text-[15px] font-semibold">
                  <Lock className="size-4" /> Money held by PayPal.
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-white/50">Never by the other side, and never by us.</p>
              </div>
              <div>
                <p className="flex items-center gap-2 text-[15px] font-semibold">
                  <ShieldCheck className="size-4" /> Every step signed.
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-white/50">Check the whole history in your own browser.</p>
              </div>
            </div>
          </div>
          <LinkCheck />
        </div>

        <div className="mt-24 grid gap-10 border-t border-white/10 pt-12 sm:grid-cols-[1.2fr_repeat(3,1fr)]">
          <div>
            <p className="text-3xl font-bold tracking-[-0.06em]">
              Kept<span className="text-pp">.</span>
            </p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/45">Every promise, kept.</p>
          </div>
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <p className="text-sm text-white/40">{c.title}</p>
              <ul className="mt-4 space-y-2.5">
                {c.links.map((l) => (
                  <li key={l.href}>
                    {l.href.startsWith("http") ? (
                      <a href={l.href} target="_blank" rel="noopener noreferrer" className="text-[15px] text-white/80 transition-colors hover:text-white">
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className="text-[15px] text-white/80 transition-colors hover:text-white">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col gap-3 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} Kept. Built for the PayPal AI Hackathon. Sandbox only: no real money moves.</p>
          <div className="flex gap-5">
            <a href={site.github} target="_blank" rel="noopener noreferrer" className="hover:text-white">
              GitHub
            </a>
            <Link href="/docs/security" className="hover:text-white">
              Report a vulnerability
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
