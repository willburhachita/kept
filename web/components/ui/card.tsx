import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type CardTone = "light" | "dark" | "sunken" | "outline" | "blue";

const tones: Record<CardTone, string> = {
  light: "bg-surface",
  dark: "bg-ink text-white",
  sunken: "bg-sunken",
  outline: "border border-line bg-transparent",
  blue: "bg-pp text-white",
};

/** Borderless white card on the grey canvas. */
export function Card({ tone = "light", className, ...rest }: HTMLAttributes<HTMLDivElement> & { tone?: CardTone }) {
  return <div className={cn("rounded-card p-6", tones[tone], className)} {...rest} />;
}

/** Card header: small eyebrow, title, optional action on the right. */
export function CardHeader({
  eyebrow,
  title,
  action,
  className,
  children,
}: {
  eyebrow?: ReactNode;
  title?: ReactNode;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("mb-5 flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        {title && <h3 className="text-xl leading-tight">{title}</h3>}
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Label/value rows for numbers ("Held · $200.00"). */
export function DataRow({ label, value, hint, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0", className)}>
      <dt className="text-sm text-muted">
        {label}
        {hint && <span className="mt-0.5 block text-xs text-faint">{hint}</span>}
      </dt>
      <dd className="tabular text-right text-sm text-ink">{value}</dd>
    </div>
  );
}
