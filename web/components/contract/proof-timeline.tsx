"use client";

import { Check, CircleHelp, Lightbulb, X } from "lucide-react";
import type { CompileRun } from "@/lib/convex";
import { duration } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

const STAGE_LABEL: Record<string, string> = {
  spec: "Writing the promises",
  clauses: "Drafting the rules",
  verify: "Proving every outcome",
  repair: "Repairing a broken rule",
  finish: "Finishing up",
};

interface StepData {
  firstCounterexample?: { property: string; steps: string[]; outcome: string } | null;
  states?: number;
  ms?: number;
}

/** Live stream of the compile run: each step pulses while running, then locks green or red. */
export function ProofTimeline({ run }: { run: NonNullable<CompileRun> }) {
  const now = useNow(1000);
  const running = run.status === "running";
  const elapsed = (run.finishedAt ?? now) - run.startedAt;
  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-4">
        <p className="eyebrow">Proof timeline</p>
        <p className="tabular text-xs text-muted">
          {running ? "running" : run.status} · {duration(elapsed)}
          {run.model ? ` · ${run.model}` : ""}
        </p>
      </div>
      <ol className="relative space-y-1">
        <span aria-hidden="true" className="absolute bottom-3 left-[11px] top-3 w-px bg-line" />
        {run.steps.map((s, i) => {
          const data = (s.data ?? {}) as StepData;
          return (
            <li key={`${s.kind}-${i}`} className="relative flex animate-rise gap-4 py-2.5">
              <span className={cn("relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-white", s.ok ? "bg-ok" : "bg-bad")}>
                {s.ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] text-ink">{s.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-muted">{s.detail}</p>
                {typeof data.states === "number" && (
                  <p className="tabular mt-1 text-xs text-faint">
                    {data.states.toLocaleString()} states checked{typeof data.ms === "number" ? ` in ${data.ms < 1 ? "<1" : Math.round(data.ms)} ms` : ""}
                  </p>
                )}
                {data.firstCounterexample && (
                  <div className="mt-3 rounded-2xl bg-bad-tint/70 p-4 text-sm">
                    <p className="font-medium text-bad">Broken: {data.firstCounterexample.property}</p>
                    <ol className="mt-2 list-decimal space-y-1 pl-4 text-ink-2">
                      {data.firstCounterexample.steps.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ol>
                    <p className="mt-2 text-bad">{data.firstCounterexample.outcome}</p>
                  </div>
                )}
              </div>
            </li>
          );
        })}
        {running && (
          <li className="relative flex gap-4 py-2.5">
            <span className="relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-pp-tint text-pp">
              <Spinner className="size-3.5" />
            </span>
            <div>
              <p className="text-[15px] text-ink">{STAGE_LABEL[run.stage] ?? "Working"}…</p>
              <p className="mt-0.5 text-sm text-muted">This usually takes under a minute. You can leave this page; it keeps going.</p>
            </div>
          </li>
        )}
        {run.status === "failed" && run.error && (
          <li className="relative flex gap-4 py-2.5">
            <span className="relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-bad text-white">
              <X className="size-3.5" />
            </span>
            <p className="text-sm text-bad">{run.error}</p>
          </li>
        )}
      </ol>
      {(run.assumptions.length > 0 || run.questions.length > 0) && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {run.assumptions.length > 0 && (
            <div className="rounded-2xl bg-pp-tint p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-pp-deep">
                <Lightbulb className="size-4" /> Assumptions Claude made
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm leading-relaxed text-ink-2">
                {run.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {run.questions.length > 0 && (
            <div className="rounded-2xl bg-warn-tint p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-warn">
                <CircleHelp className="size-4" /> Worth clarifying
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm leading-relaxed text-ink-2">
                {run.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
