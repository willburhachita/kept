"use client";

import { ArrowRight, BookOpen, Compass, ShieldCheck, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const SEEN = "kept:guide:seen";

const STEPS = [
  { t: "Describe the deal", d: "Write it like a text message: who pays, how much, for what, and by when." },
  { t: "Kept checks the rules", d: "It turns your words into clear rules and tests every way things could go, so nobody gets cheated by a loophole." },
  { t: "Both of you agree", d: "You each approve the same terms. A short code lets you confirm you're looking at the same deal." },
  { t: "PayPal holds the money", d: "The payer puts the money on hold. It's released only when the work is accepted, or returned if it isn't delivered." },
];

/** Tips for the page the visitor is on. */
function tipsFor(path: string): { title: string; tips: string[] } {
  if (path.startsWith("/new")) return { title: "Making a promise", tips: ["New to this? Pick “Proved template” to try a ready-made deal in one click.", "Add the other person's email to send them an invite.", "Nothing is charged here. Money only moves after you both approve and the payer funds it."] };
  if (path.startsWith("/contracts/")) return { title: "Inside a promise", tips: ["The buttons only show what you can do next.", "Compare the 8-character code with the other person before you approve.", "“Verify in browser” checks every receipt yourself, so you don't have to trust us."] };
  if (path.startsWith("/contracts")) return { title: "Your promises", tips: ["“Needs action” shows the ones waiting on you.", "Open any promise to see where every cent is right now."] };
  if (path.startsWith("/mandates")) return { title: "Agent budgets", tips: ["Give an AI agent a spending limit instead of your card.", "Anything above your approval line waits for you.", "Close a budget any time; the unused money is released."] };
  if (path.startsWith("/settings")) return { title: "Settings and developers", tips: ["Add your PayPal email so you can get paid.", "API keys and webhooks are for platforms building on Kept. Keys are shown once: save them somewhere safe."] };
  if (path.startsWith("/dashboard")) return { title: "Your overview", tips: ["Start with “New promise”. A ready-made template takes one click.", "Anything waiting on you shows at the top."] };
  if (path.startsWith("/docs")) return { title: "Documentation", tips: ["Start with “What Kept is”, then the Quickstart.", "Building a marketplace? Read “Embed Kept in your platform”."] };
  if (path.startsWith("/verify")) return { title: "Trust tools", tips: ["Paste any link someone sent you to check it's really us.", "Drop a proof file to check a promise's whole history."] };
  if (path.startsWith("/invite")) return { title: "You were invited", tips: ["Sign up free to see the deal. Approving costs nothing.", "Never pay outside PayPal, and never share passwords or codes."] };
  return { title: "Welcome", tips: ["Scroll down and press “Run the verifier” to see Kept catch a real mistake.", "Ready? “Make a promise” takes about a minute."] };
}

/** Friendly concierge: a floating guide for first-time visitors, available on every page. */
export function Guide() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [nudge, setNudge] = useState(false);
  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem(SEEN) === "1";
    } catch {
      /* storage unavailable */
    }
    if (seen) return;
    const id = setTimeout(() => setNudge(true), 2500);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => setOpen(false), [pathname]);

  function markSeen() {
    setNudge(false);
    try {
      localStorage.setItem(SEEN, "1");
    } catch {
      /* ignore */
    }
  }
  if (pathname.startsWith("/sim")) return null;
  const { title, tips } = tipsFor(pathname);

  return (
    <div className="fixed bottom-4 right-4 z-[55] flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open && (
        <div role="dialog" aria-label="Guide" className="w-[min(92vw,24rem)] animate-rise overflow-hidden rounded-card bg-surface text-ink shadow-lift ring-1 ring-black/5">
          <div className="flex items-start justify-between gap-4 bg-ink p-5 text-white">
            <div>
              <p className="text-xs text-white/50">Guide</p>
              <p className="mt-1 text-lg font-semibold leading-snug tracking-[-0.035em]">Kept makes sure money only moves when a promise is kept.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close the guide" className="-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
              <X className="size-4" />
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-5">
            <ol className="space-y-3.5">
              {STEPS.map((s, i) => (
                <li key={s.t} className="flex gap-3">
                  <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-semibold">{i + 1}</span>
                  <div>
                    <p className="text-sm font-semibold tracking-[-0.02em]">{s.t}</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-5 rounded-2xl bg-canvas p-4">
              <p className="text-sm font-semibold tracking-[-0.02em]">{title}</p>
              <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-ink-2">
                {tips.map((t) => (
                  <li key={t} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-ink" aria-hidden="true" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-5 grid gap-2">
              {[
                { href: "/new", icon: Sparkles, label: "Try it with a ready-made example" },
                { href: "/docs", icon: BookOpen, label: "Read the documentation" },
                { href: "/docs/scam-protection", icon: ShieldCheck, label: "How Kept keeps you safe" },
              ].map((l) => (
                <Link key={l.href} href={l.href} onClick={markSeen} className="group flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3 text-sm hover:border-ink">
                  <span className="flex items-center gap-2.5">
                    <l.icon className="size-4 text-muted" /> {l.label}
                  </span>
                  <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
      {nudge && !open && (
        <div className="flex max-w-[16rem] animate-rise items-start gap-2 rounded-2xl bg-surface p-3 pl-4 text-sm shadow-lift ring-1 ring-black/5">
          <p className="leading-snug">New here? Here&apos;s how Kept works in a minute.</p>
          <button type="button" onClick={markSeen} aria-label="Dismiss" className="shrink-0 text-faint hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          markSeen();
        }}
        aria-expanded={open}
        className={cn("inline-flex h-12 items-center gap-2 rounded-full px-5 text-sm font-semibold shadow-lift transition-colors", open ? "bg-surface text-ink ring-1 ring-black/10" : "bg-ink text-white hover:bg-ink-2")}
      >
        {open ? <X className="size-4" /> : <Compass className="size-4" />}
        {open ? "Close" : "Guide"}
      </button>
    </div>
  );
}
