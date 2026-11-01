import Link from "next/link";
import { site } from "@/lib/site";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#how", label: "How it works" },
      { href: "/#safety", label: "Scam protection" },
      { href: "/#agents", label: "Agent mandates" },
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
    <footer className="bg-ink px-5 pb-10 pt-20 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <p className="text-[clamp(3.5rem,9vw,7rem)] font-bold leading-[0.85] tracking-[-0.07em]">
              Kept<span className="text-pp">.</span>
            </p>
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-white/55">
              Plain-English deals, proved before anyone pays, held on PayPal, released only when the promise is kept.
            </p>
          </div>
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <p className="eyebrow text-white/40">{c.title}</p>
              <ul className="mt-4 space-y-2.5">
                {c.links.map((l) => (
                  <li key={l.href}>
                    {l.href.startsWith("http") ? (
                      <a href={l.href} target="_blank" rel="noopener noreferrer" className="text-sm text-white/75 transition-colors hover:text-white">
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className="text-sm text-white/75 transition-colors hover:text-white">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-16 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <p>Built for the PayPal AI Hackathon. Runs on the PayPal sandbox: no real money moves.</p>
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
