import type { ReactNode } from "react";
import type { StatusMeta, Tone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { LiveDot } from "./spinner";

const tones: Record<Tone | "glass" | "glass-dark", string> = {
  neutral: "bg-black/[0.05] text-ink-2",
  ink: "bg-ink text-white",
  blue: "bg-pp-tint text-pp-deep",
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-warn",
  bad: "bg-bad-tint text-bad",
  glass: "bg-white/70 text-ink backdrop-blur",
  "glass-dark": "bg-white/15 text-white backdrop-blur",
};

/** Small pill label (Lint's "Event · Stills" chips). */
export function Chip({
  tone = "neutral",
  dot,
  live,
  icon,
  className,
  children,
  title,
}: {
  tone?: Tone | "glass" | "glass-dark";
  dot?: boolean;
  live?: boolean;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium tracking-[-0.01em]", tones[tone], className)}
    >
      {live ? <LiveDot className="size-1.5" /> : dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : icon}
      {children}
    </span>
  );
}

/** A status pill from lib/status metadata. */
export function StatusChip({ meta, className }: { meta: StatusMeta; className?: string }) {
  return (
    <Chip tone={meta.tone} live={meta.live} dot={!meta.live} className={className} title={meta.hint}>
      {meta.label}
    </Chip>
  );
}
