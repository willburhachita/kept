"use client";

import { Minus, Plus } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface AccordionItem {
  title: ReactNode;
  body: ReactNode;
  /** Small number shown before the title in numbered lists ("001"). */
  index?: string;
  tags?: string[];
}

/**
 * Rows that open one at a time. `dark` is the numbered list on a black section;
 * `cards` is white rounded rows with a black round toggle (the FAQ).
 */
export function Accordion({ items, variant = "cards", defaultOpen = 0 }: { items: AccordionItem[]; variant?: "dark" | "cards"; defaultOpen?: number | null }) {
  const [open, setOpen] = useState<number | null>(defaultOpen);
  const base = useId();
  if (variant === "dark") {
    return (
      <ul className="border-t border-white/10">
        {items.map((it, i) => {
          const isOpen = open === i;
          return (
            <li key={i} className="border-b border-white/10">
              <button
                type="button"
                id={`${base}-b${i}`}
                aria-expanded={isOpen}
                aria-controls={`${base}-p${i}`}
                onClick={() => setOpen(isOpen ? null : i)}
                className="grid w-full grid-cols-[3rem_1fr_auto] items-center gap-4 py-6 text-left sm:grid-cols-[5rem_1fr_auto]"
              >
                <span className="tabular text-sm text-white/40">{it.index}</span>
                <span className="text-[clamp(1.25rem,2vw,1.625rem)] font-semibold tracking-[-0.04em] text-white">{it.title}</span>
                <span className="flex size-9 items-center justify-center rounded-full border border-white/15 text-white/80">{isOpen ? <Minus className="size-4" /> : <Plus className="size-4" />}</span>
              </button>
              <div id={`${base}-p${i}`} role="region" aria-labelledby={`${base}-b${i}`} className={cn("grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                <div className="overflow-hidden">
                  <div className="grid gap-5 pb-8 sm:grid-cols-[5rem_1fr_1fr] sm:gap-4">
                    <span className="hidden sm:block" />
                    <div className="text-[15px] leading-relaxed text-white/65">{it.body}</div>
                    {it.tags && (
                      <div className="flex flex-wrap content-start gap-2">
                        {it.tags.map((t) => (
                          <span key={t} className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/80">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((it, i) => {
        const isOpen = open === i;
        return (
          <li key={i} className="overflow-hidden rounded-card bg-surface">
            <button
              type="button"
              id={`${base}-b${i}`}
              aria-expanded={isOpen}
              aria-controls={`${base}-p${i}`}
              onClick={() => setOpen(isOpen ? null : i)}
              className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left"
            >
              <span className="text-[17px] font-medium tracking-[-0.03em] text-ink">{it.title}</span>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-white">{isOpen ? <Minus className="size-3.5" /> : <Plus className="size-3.5" />}</span>
            </button>
            <div id={`${base}-p${i}`} role="region" aria-labelledby={`${base}-b${i}`} className={cn("grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
              <div className="overflow-hidden">
                <div className="px-6 pb-6 text-[15px] leading-relaxed text-muted md:w-[88%]">{it.body}</div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
