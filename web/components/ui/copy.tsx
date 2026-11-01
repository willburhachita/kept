"use client";

import { Check, Copy } from "lucide-react";
import { useCopy } from "@/lib/hooks";
import { fingerprint, shortHash } from "@/lib/format";
import { cn } from "@/lib/utils";

export function CopyButton({ value, label = "Copy", className, dark }: { value: string; label?: string; className?: string; dark?: boolean }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
        dark ? "text-white/60 hover:bg-white/10 hover:text-white" : "text-muted hover:bg-black/[0.06] hover:text-ink",
        className,
      )}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/** A hash in mono, shortened, copyable. `mode="fingerprint"` groups the first 8 chars for reading aloud. */
export function Hash({ value, chars = 10, mode = "short", copy = true, className, dark }: { value: string | null | undefined; chars?: number; mode?: "short" | "fingerprint" | "full"; copy?: boolean; className?: string; dark?: boolean }) {
  if (!value) return <span className="text-faint">—</span>;
  const shown = mode === "fingerprint" ? fingerprint(value, chars) : mode === "full" ? value : shortHash(value, chars);
  return (
    <span className={cn("inline-flex max-w-full items-center gap-0.5", className)}>
      <code title={value} className={cn("truncate font-mono text-[0.8em]", dark ? "text-white/80" : "text-ink-2")}>
        {shown}
      </code>
      {copy && <CopyButton value={value} label="Copy full value" dark={dark} />}
    </span>
  );
}

/** A secret shown exactly once (API keys, agent tokens, webhook secrets). */
export function SecretReveal({ value, title, note }: { value: string; title: string; note?: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="rounded-2xl bg-ink p-4 text-white">
      <p className="text-sm text-white/60">{title}</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-sm">{value}</code>
        <button type="button" onClick={() => copy(value)} className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-white/85">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-white/50">{note ?? "Shown once. Kept stores only a SHA-256 hash, so it can't be recovered: store it in your secret manager now."}</p>
    </div>
  );
}
