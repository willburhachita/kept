import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** "(01) · How it works" (Lint's numbered section labels). */
export function SectionLabel({ index, children, className, dark }: { index?: string; children: ReactNode; className?: string; dark?: boolean }) {
  return (
    <p className={cn("eyebrow flex items-center gap-2", dark && "text-white/55", className)}>
      {index && <span className="tabular">({index})</span>}
      {index && <span aria-hidden="true">·</span>}
      <span>{children}</span>
    </p>
  );
}

/**
 * Big editorial statement whose tail fades to grey ("…the way the room
 * actually felt — alive, unrepeatable…").
 */
export function Statement({ lead, tail, className, dark, as: Tag = "h2" }: { lead: ReactNode; tail?: ReactNode; className?: string; dark?: boolean; as?: "h1" | "h2" | "p" }) {
  return (
    <Tag className={cn("text-[clamp(1.75rem,3.4vw,2.75rem)] font-normal leading-[1.18] tracking-[-0.04em]", dark ? "text-white" : "text-ink", className)}>
      {lead}
      {tail && <span className={cn(dark ? "text-white/35" : "text-faint")}> {tail}</span>}
    </Tag>
  );
}

/** Page header used inside the app. */
export function PageHeader({ eyebrow, title, description, actions, className }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn("mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-3">{eyebrow}</div>}
        <h1 className="text-[clamp(1.875rem,3vw,2.5rem)] leading-[1.1] tracking-[-0.045em]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Big number with a label (dashboard stats, money). */
export function Stat({ label, value, sub, className, dark }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string; dark?: boolean }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className={cn("text-sm", dark ? "text-white/55" : "text-muted")}>{label}</p>
      <p className="tabular mt-1 truncate text-[clamp(1.5rem,2.4vw,2rem)] leading-tight tracking-[-0.045em]">{value}</p>
      {sub && <p className={cn("mt-1 text-xs", dark ? "text-white/45" : "text-faint")}>{sub}</p>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line-2 bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</kbd>;
}
