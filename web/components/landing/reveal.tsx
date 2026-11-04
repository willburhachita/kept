"use client";

import type { ReactNode } from "react";
import { useInView } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/** Fades and lifts its children in the first time they scroll into view. */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.05);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn("transition-[opacity,transform] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]", inView ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0", className)}
    >
      {children}
    </div>
  );
}
