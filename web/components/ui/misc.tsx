"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** PayPal-style segmented pill toggle ("Personal | Business"). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  className?: string;
  size?: "sm" | "md";
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-full bg-black/[0.05] p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full font-medium tracking-[-0.02em] transition-[background-color,color,box-shadow] duration-200 disabled:opacity-40",
            size === "sm" ? "h-7 px-3 text-xs" : "h-9 px-4 text-sm",
            value === o.value ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} aria-hidden="true" />;
}

export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-card border border-dashed border-line-2 px-6 py-14 text-center", className)}>
      {icon && <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface text-ink shadow-card">{icon}</div>}
      <p className="text-lg tracking-[-0.03em]">{title}</p>
      {body && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Horizontal stacked bar (money splits, budgets). Segments are fractions of `total`. */
export function StackedBar({
  total,
  segments,
  className,
  height = "h-3",
}: {
  total: number;
  segments: { value: number; className: string; label: string }[];
  className?: string;
  height?: string;
}) {
  const t = Math.max(total, 1);
  return (
    <div className={cn("flex w-full overflow-hidden rounded-full bg-black/[0.06]", height, className)} role="img" aria-label={segments.map((s) => `${s.label} ${Math.round((s.value / t) * 100)}%`).join(", ")}>
      {segments.map((s) =>
        s.value > 0 ? (
          <div key={s.label} title={s.label} className={cn("h-full transition-[width] duration-700 ease-out", s.className)} style={{ width: `${(s.value / t) * 100}%` }} />
        ) : null,
      )}
    </div>
  );
}

/** Thin progress meter. */
export function Meter({ value, max = 1, className, barClassName }: { value: number; max?: number; className?: string; barClassName?: string }) {
  const p = Math.min(1, Math.max(0, value / (max || 1)));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-black/[0.07]", className)} role="progressbar" aria-valuenow={Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full bg-ink transition-[width] duration-700 ease-out", barClassName)} style={{ width: `${p * 100}%` }} />
    </div>
  );
}
