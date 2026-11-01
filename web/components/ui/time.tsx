"use client";

import { duration, relative } from "@/lib/format";
import { useMounted, useNow } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/** Live countdown to an epoch-ms time ("3d 4h 12m", then "passed"). */
export function Countdown({ to, parts = 3, passedLabel = "passed", className }: { to: number | null | undefined; parts?: number; passedLabel?: string; className?: string }) {
  const now = useNow(1000);
  const mounted = useMounted();
  if (!to) return <span className="text-faint">—</span>;
  const left = to - now;
  return (
    <time dateTime={new Date(to).toISOString()} className={cn("tabular", className)} suppressHydrationWarning>
      {!mounted ? "…" : left <= 0 ? passedLabel : duration(left, parts)}
    </time>
  );
}

/** "2m ago" / "in 3d 4h", refreshed every 30s. */
export function RelativeTime({ at, className }: { at: number | null | undefined; className?: string }) {
  const now = useNow(30_000);
  const mounted = useMounted();
  if (!at) return <span className="text-faint">—</span>;
  return (
    <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()} className={className} suppressHydrationWarning>
      {mounted ? relative(at, now) : ""}
    </time>
  );
}

/** Ring that empties as a window closes (evidence challenge windows, approvals). */
export function CountdownRing({ startedAt, endsAt, size = 44, className }: { startedAt: number; endsAt: number; size?: number; className?: string }) {
  const now = useNow(1000);
  const total = Math.max(1, endsAt - startedAt);
  const left = Math.min(1, Math.max(0, (endsAt - now) / total));
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn("-rotate-90", className)} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" strokeOpacity="0.12" strokeWidth="4" fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - left)} className="transition-[stroke-dashoffset] duration-1000 ease-linear" />
    </svg>
  );
}
