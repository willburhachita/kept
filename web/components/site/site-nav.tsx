"use client";

import { useConvexAuth } from "convex/react";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#safety", label: "Safety" },
  { href: "/#agents", label: "Agents" },
  { href: "/verify", label: "Verify" },
  { href: "/docs", label: "Docs" },
];

/**
 * Floating glass pill nav. Transparent with white text over a dark hero
 * (`overDark`), turning into a white pill once the page scrolls.
 */
export function SiteNav({ overDark = false }: { overDark?: boolean }) {
  const { isAuthenticated } = useConvexAuth();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => setOpen(false), [pathname]);
  const dark = overDark && !scrolled && !open;

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
      <nav
        aria-label="Main"
        className={cn(
          "mx-auto flex h-16 max-w-6xl items-center justify-between rounded-2xl px-4 transition-[background-color,box-shadow,color] duration-300 sm:px-6",
          dark ? "bg-transparent text-white" : "glass text-ink shadow-float",
        )}
      >
        <div className="flex items-center gap-3">
          <Logo dark={dark} />
        </div>
        <ul className="hidden items-center gap-1 lg:flex">
          {LINKS.map((l) => {
            const active = l.href === pathname || (l.href !== "/" && !l.href.startsWith("/#") && pathname.startsWith(l.href));
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className={cn(
                    "relative rounded-full px-3 py-2 text-[15px] font-semibold tracking-[-0.02em] transition-colors",
                    dark ? "text-white/75 hover:text-white" : "text-muted hover:text-ink",
                    active && (dark ? "text-white" : "text-ink"),
                  )}
                >
                  {l.label}
                  {active && <span className="absolute inset-x-3 -bottom-0.5 h-px bg-current" />}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-2">
          {isAuthenticated ? (
            <Button href="/dashboard" size="sm" variant={dark ? "inverse" : "primary"}>
              Open app
            </Button>
          ) : (
            <>
              <Button href="/signin" size="sm" variant={dark ? "inverse-ghost" : "ghost"} className="hidden sm:inline-flex">
                Sign in
              </Button>
              <Button href="/signin?mode=signUp" size="sm" variant={dark ? "inverse" : "primary"}>
                Make a promise
              </Button>
            </>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className={cn("ml-1 inline-flex size-9 items-center justify-center rounded-full lg:hidden", dark ? "hover:bg-white/10" : "hover:bg-black/5")}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </nav>
      {open && (
        <div className="glass mx-auto mt-2 max-w-6xl animate-rise rounded-2xl p-3 shadow-float lg:hidden">
          <ul className="grid gap-1">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="block rounded-xl px-3 py-3 text-base tracking-[-0.03em] hover:bg-black/5">
                  {l.label}
                </Link>
              </li>
            ))}
            {!isAuthenticated && (
              <li>
                <Link href="/signin" className="block rounded-xl px-3 py-3 text-base tracking-[-0.03em] hover:bg-black/5">
                  Sign in
                </Link>
              </li>
            )}
          </ul>
        </div>
      )}
    </header>
  );
}
