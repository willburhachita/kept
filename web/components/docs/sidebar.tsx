"use client";

import { Menu, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { DOCS, SECTIONS } from "@/content/docs";
import { cn } from "@/lib/utils";

type Index = { slug: string; title: string; description: string; headings: { text: string; id: string }[] }[];

/** Docs navigation with instant search over titles, descriptions and headings. */
export function DocsSidebar({ index }: { index: Index }) {
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return null;
    const out: { href: string; title: string; sub: string }[] = [];
    for (const d of index) {
      if (d.title.toLowerCase().includes(s) || d.description.toLowerCase().includes(s)) out.push({ href: `/docs/${d.slug}`, title: d.title, sub: d.description });
      for (const h of d.headings) if (h.text.toLowerCase().includes(s)) out.push({ href: `/docs/${d.slug}#${h.id}`, title: h.text, sub: d.title });
    }
    return out.slice(0, 12);
  }, [q, index]);

  const nav = (
    <nav aria-label="Documentation" className="space-y-7">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the docs"
          aria-label="Search the docs"
          className="h-10 w-full rounded-full border border-line bg-surface pl-9 pr-3 text-sm placeholder:text-faint focus:border-ink focus:outline-none"
        />
      </div>
      {results ? (
        <ul className="space-y-1">
          {results.length === 0 && <li className="px-3 text-sm text-muted">No matches.</li>}
          {results.map((r) => (
            <li key={r.href}>
              <Link href={r.href} onClick={() => setQ("")} className="block rounded-xl px-3 py-2 hover:bg-black/[0.04]">
                <span className="block text-sm text-ink">{r.title}</span>
                <span className="block truncate text-xs text-muted">{r.sub}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        SECTIONS.map((s) => (
          <div key={s}>
            <p className="eyebrow mb-2 px-3">{s}</p>
            <ul className="space-y-0.5">
              {DOCS.filter((d) => d.section === s).map((d) => {
                const active = pathname === `/docs/${d.slug}`;
                return (
                  <li key={d.slug}>
                    <Link href={`/docs/${d.slug}`} className={cn("block rounded-xl px-3 py-1.5 text-sm transition-colors", active ? "bg-ink text-white" : "text-muted hover:bg-black/[0.04] hover:text-ink")}>
                      {d.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </nav>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} className="mb-6 inline-flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-sm lg:hidden" aria-expanded={open}>
        {open ? <X className="size-4" /> : <Menu className="size-4" />} Documentation menu
      </button>
      {open && <div className="mb-8 rounded-card bg-surface p-4 lg:hidden">{nav}</div>}
      <aside className="sticky top-28 hidden max-h-[calc(100dvh-8rem)] overflow-y-auto pb-10 pr-2 lg:block">{nav}</aside>
    </>
  );
}

/** "On this page", highlighting the section in view. */
export function Toc({ headings }: { headings: { depth: 2 | 3; text: string; id: string }[] }) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const els = headings.map((h) => document.getElementById(h.id)).filter(Boolean) as HTMLElement[];
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setActive(top.target.id);
    }, { rootMargin: "-80px 0px -70% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [headings]);
  if (!headings.length) return null;
  return (
    <nav aria-label="On this page" className="sticky top-28 hidden xl:block">
      <p className="eyebrow mb-3">On this page</p>
      <ul className="space-y-1.5 border-l border-line">
        {headings.map((h) => (
          <li key={h.id}>
            <a href={`#${h.id}`} className={cn("-ml-px block border-l py-0.5 text-[13px] transition-colors", h.depth === 3 ? "pl-6" : "pl-3", active === h.id ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink")}>
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
