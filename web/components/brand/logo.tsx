import Link from "next/link";
import { cn } from "@/lib/utils";

/** "Kept." wordmark with the blue full stop, plus an optional tagline. */
export function Logo({ href = "/", tagline = false, dark = false, className }: { href?: string | null; tagline?: boolean; dark?: boolean; className?: string }) {
  const mark = (
    <span className={cn("inline-flex flex-col leading-none", className)}>
      <span className={cn("text-[22px] font-bold tracking-[-0.06em]", dark ? "text-white" : "text-ink")}>
        Kept<span className="text-pp">.</span>
      </span>
      {tagline && <span className={cn("mt-1 text-[12px] tracking-[-0.02em]", dark ? "text-white/70" : "text-muted")}>Every promise, kept.</span>}
    </span>
  );
  if (href === null) return mark;
  return (
    <Link href={href} aria-label="Kept home" className="rounded-md">
      {mark}
    </Link>
  );
}
