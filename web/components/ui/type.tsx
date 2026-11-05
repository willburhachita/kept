import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Small plain section label ("What we do"). `index` is accepted but not shown: labels stay plain. */
export function SectionLabel({ children, className, dark }: { index?: string; children: ReactNode; className?: string; dark?: boolean }) {
  return <p className={cn("text-[15px] font-medium tracking-[-0.03em]", dark ? "text-white/55" : "text-muted", className)}>{children}</p>;
}

/** Bold two-tone heading: the lead in ink, the tail in grey on the next beat. */
export function Statement({ lead, tail, className, dark, as: Tag = "h2" }: { lead: ReactNode; tail?: ReactNode; className?: string; dark?: boolean; as?: "h1" | "h2" | "p" }) {
  return (
    <Tag className={cn("text-[clamp(2rem,3.8vw,3.25rem)] font-semibold leading-[1.08] tracking-[-0.05em]", dark ? "text-white" : "text-ink", className)}>
      {lead}
      {tail && <span className={cn(dark ? "text-white/40" : "text-[#a3a3a3]")}> {tail}</span>}
    </Tag>
  );
}

/** Page header used inside the app. */
export function PageHeader({ eyebrow, title, description, actions, className }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn("mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-3">{eyebrow}</div>}
        <h1 className="text-[clamp(2rem,3.2vw,2.75rem)] font-semibold leading-[1.05] tracking-[-0.05em]">{title}</h1>
        {description && <p className="mt-2.5 max-w-2xl text-[15px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Big number with a label (dashboard stats, money). */
export function Stat({ label, value, sub, className, dark }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string; dark?: boolean }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className={cn("text-sm font-medium", dark ? "text-white/55" : "text-muted")}>{label}</p>
      <p className="tabular mt-1.5 truncate text-[clamp(1.625rem,2.6vw,2.25rem)] font-semibold leading-tight tracking-[-0.05em]">{value}</p>
      {sub && <p className={cn("mt-1 text-xs", dark ? "text-white/45" : "text-faint")}>{sub}</p>}
    </div>
  );
}

/** Two-column section: a narrow label column on the left, content on the right. */
export function SectionGrid({ label, children, className, dark }: { label?: ReactNode; children: ReactNode; className?: string; dark?: boolean }) {
  return (
    <div className={cn("grid gap-6 md:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] md:gap-10", className)}>
      <div className="md:pt-3">{label && <SectionLabel dark={dark}>{label}</SectionLabel>}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line-2 bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</kbd>;
}
