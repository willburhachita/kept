"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Bell, ChevronDown, LogOut, Plus, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { RelativeTime } from "@/components/ui/time";
import { api } from "@/lib/convex";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/contracts", label: "Promises" },
  { href: "/mandates", label: "Agents" },
  { href: "/settings", label: "Developers" },
  { href: "/docs", label: "Docs" },
];

/** Where a notification about `stream` should take you. */
export function streamHref(kind: string, stream: string | null): string | null {
  if (!stream) return null;
  return /^(mandate|spend|token)\./.test(kind) ? `/mandates/${stream}` : `/contracts/${stream}`;
}

function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onOutside]);
  return ref;
}

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const count = useQuery(api.notifications.unreadCount) ?? 0;
  const items = useQuery(api.notifications.list, open ? { limit: 12 } : "skip");
  const markRead = useMutation(api.notifications.markRead);
  const ref = useClickOutside(() => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={count ? `${count} unread notifications` : "Notifications"}
        aria-expanded={open}
        className="relative inline-flex size-9 items-center justify-center rounded-full text-ink hover:bg-black/5"
      >
        <Bell className="size-[18px]" />
        {count > 0 && (
          <span className="tabular absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-pp px-1 text-[10px] font-semibold leading-[18px] text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-[min(92vw,24rem)] animate-rise overflow-hidden rounded-2xl bg-surface shadow-lift ring-1 ring-black/5">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-medium">Notifications</p>
            {count > 0 && (
              <button type="button" onClick={() => markRead({})} className="text-xs text-pp hover:text-pp-deep">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {items === undefined && (
              <li className="flex justify-center p-6">
                <Spinner />
              </li>
            )}
            {items?.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">Nothing yet. Updates on your promises land here.</li>}
            {items?.map((n) => {
              const href = streamHref(n.kind, n.stream);
              const body = (
                <div className="flex gap-3 px-4 py-3">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-pp")} />
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{n.title}</p>
                    {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{n.body}</p>}
                    <RelativeTime at={n.at} className="mt-1 block text-[11px] text-faint" />
                  </div>
                </div>
              );
              return (
                <li key={n._id} className="border-b border-line last:border-0 hover:bg-sunken">
                  {href ? (
                    <Link
                      href={href}
                      onClick={() => {
                        setOpen(false);
                        if (!n.read) void markRead({ ids: [n._id] });
                      }}
                    >
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const viewer = useQuery(api.users.viewer);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const name = viewer?.displayName ?? "…";
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-black/5">
        <span className="flex size-7 items-center justify-center rounded-full bg-ink text-xs font-medium uppercase text-white">{name.slice(0, 1)}</span>
        <span className="hidden max-w-[10rem] truncate text-sm sm:inline">{name}</span>
        <ChevronDown className="size-3.5 text-muted" />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-64 animate-rise overflow-hidden rounded-2xl bg-surface p-1.5 shadow-lift ring-1 ring-black/5">
          <div className="px-3 py-2.5">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-muted">{viewer?.email}</p>
            {viewer && !viewer.payoutEmail && <p className="mt-2 rounded-lg bg-warn-tint px-2 py-1.5 text-xs text-warn">Add your PayPal payout email to get paid.</p>}
          </div>
          <Link href="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-black/5">
            <Settings className="size-4 text-muted" /> Settings & developers
          </Link>
          {(viewer?.role === "arbiter" || viewer?.role === "admin") && (
            <Link href="/arbiter" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-black/5">
              <ShieldCheck className="size-4 text-muted" /> Arbiter desk
            </Link>
          )}
          <button
            type="button"
            onClick={async () => {
              await signOut();
              router.replace("/");
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5"
          >
            <LogOut className="size-4 text-muted" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Signed-in chrome: floating glass bar with sections, new-promise button, notifications and the account menu. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const viewer = useQuery(api.users.viewer);
  const staff = viewer?.role === "arbiter" || viewer?.role === "admin";
  const nav = staff ? [...NAV, { href: "/arbiter", label: "Arbiter" }] : NAV;
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5">
        <div className="glass mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 rounded-2xl px-3 shadow-float sm:px-5">
          <div className="flex min-w-0 items-center gap-5">
            <Logo href="/dashboard" />
            <nav aria-label="App" className="hidden md:block">
              <ul className="flex items-center gap-0.5">
                {nav.map((l) => {
                  const active = pathname === l.href || pathname.startsWith(`${l.href}/`) || (l.href === "/contracts" && pathname === "/new");
                  return (
                    <li key={l.href}>
                      <Link href={l.href} className={cn("rounded-full px-3 py-1.5 text-sm transition-colors", active ? "bg-black/[0.06] text-ink" : "text-muted hover:text-ink")}>
                        {l.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
          <div className="flex items-center gap-1.5">
            <Button href="/new" size="sm" icon={<Plus className="size-4" />} className="hidden sm:inline-flex">
              New promise
            </Button>
            <NotificationsBell />
            <UserMenu />
          </div>
        </div>
        <nav aria-label="App sections" className="mx-auto mt-2 max-w-6xl overflow-x-auto md:hidden">
          <ul className="flex gap-1">
            {[...nav, { href: "/new", label: "New" }].map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={cn("block whitespace-nowrap rounded-full px-3 py-1.5 text-sm", pathname.startsWith(l.href) ? "bg-ink text-white" : "bg-surface text-muted")}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-5 sm:pt-10">{children}</main>
    </div>
  );
}

/** Redirects to sign-in when signed out; renders children once the session is known. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      const next = typeof window !== "undefined" ? window.location.pathname + window.location.search : pathname;
      router.replace(`/signin?next=${encodeURIComponent(next)}`);
    }
  }, [isLoading, isAuthenticated, router, pathname]);
  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-6 text-muted" />
      </div>
    );
  }
  return <>{children}</>;
}
