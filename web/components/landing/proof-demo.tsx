"use client";


import { DEFAULT_FEE_BPS, EXAMPLES, EXAMPLE_PROMPTS, formatCents, renderContract, verify, type VerificationReport } from "@kept/core";
import { Check, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { StackedBar } from "@/components/ui/misc";
import { Photo } from "@/components/ui/photo";
import { LiveDot, Spinner } from "@/components/ui/spinner";
import { PHOTOS } from "@/lib/site";
import { cn } from "@/lib/utils";

type Phase = "idle" | "running" | "broken" | "repairing" | "proved";

const PRINCIPAL = EXAMPLES.logoNaive.principalCents;

/**
 * The verifier from @kept/core, running in this browser on a real draft:
 * it finds the race in the first version, then proves the repaired one.
 */
export function ProofDemo() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [shown, setShown] = useState(0);
  const naive = useMemo(() => renderContract(EXAMPLES.logoNaive, { feeBps: DEFAULT_FEE_BPS }), []);
  const fixed = useMemo(() => renderContract(EXAMPLES.logoFixed, { feeBps: DEFAULT_FEE_BPS }), []);
  const repaired = phase === "repairing" || phase === "proved";
  const rules = repaired ? fixed.rules : naive.rules;
  const violated = report?.properties.find((p) => p.status === "violated" && p.counterexample);
  const steps = violated?.counterexample?.steps ?? [];

  useEffect(() => {
    if (phase !== "broken" || shown >= steps.length + 1) return;
    const id = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 450 : 1100);
    return () => clearTimeout(id);
  }, [phase, shown, steps.length]);

  function run() {
    setPhase("running");
    setShown(0);
    setTimeout(() => {
      setReport(verify(EXAMPLES.logoNaive, { feeBps: DEFAULT_FEE_BPS }));
      setPhase("broken");
    }, 650);
  }
  function repair() {
    setPhase("repairing");
    setTimeout(() => {
      setReport(verify(EXAMPLES.logoFixed, { feeBps: DEFAULT_FEE_BPS }));
      setPhase("proved");
    }, 900);
  }
  function reset() {
    setPhase("idle");
    setReport(null);
    setShown(0);
  }

  const promiseStatus = (id: string) => report?.properties.find((p) => p.id === `promise:${id}`)?.status;

  return (
    <div className="grid overflow-hidden rounded-card bg-surface lg:grid-cols-[1fr_1.1fr]">
      {/* The deal and the draft rules */}
      <div className="p-6 sm:p-9">
        <p className="eyebrow">The deal, in plain English</p>
        <blockquote className="mt-3 text-[1.1875rem] leading-[1.45] tracking-[-0.03em] text-ink">&ldquo;{EXAMPLE_PROMPTS.logo}&rdquo;</blockquote>

        <p className="eyebrow mt-9">Promises both sides sign</p>
        <ul className="mt-3 space-y-2">
          {EXAMPLES.logoFixed.guarantees.map((g) => {
            const s = promiseStatus(g.id);
            return (
              <li key={g.id} className={cn("flex items-start gap-3 rounded-2xl px-4 py-3 text-[15px] transition-colors duration-500", s === "violated" ? "bg-bad-tint" : s === "proved" ? "bg-ok-tint" : "bg-sunken")}>
                <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", s === "violated" ? "bg-bad text-white" : s === "proved" ? "bg-ok text-white" : "bg-line-2 text-white")}>
                  {s === "violated" ? <X className="size-3" /> : <Check className="size-3" />}
                </span>
                <span className="text-ink-2">{g.label}</span>
              </li>
            );
          })}
        </ul>

        <p className="eyebrow mt-9 flex items-center gap-2">
          {repaired ? "Rules after Claude's repair" : "Rules Claude drafted first"}
          {repaired && <span className="rounded-full bg-pp-tint px-2 py-0.5 text-[10px] text-pp-deep">repaired</span>}
        </p>
        <ol className="mt-3 space-y-2.5">
          {rules.map((r, i) => {
            const isNew = repaired && !naive.rules.includes(r);
            return (
              <li key={r} className={cn("flex gap-3 text-sm leading-relaxed", isNew ? "text-ink" : "text-muted")}>
                <span className={cn("tabular mt-px w-5 shrink-0 text-xs", isNew ? "text-pp" : "text-faint")}>{String(i + 1).padStart(2, "0")}</span>
                <span className={cn(isNew && "border-l-2 border-pp pl-3")}>{r}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* The verifier console */}
      <div className="flex min-h-[34rem] flex-col bg-ink p-6 text-white sm:p-9">
        <div className="flex items-center justify-between gap-4">
          <p className="flex items-center gap-2 text-sm text-white/60">
            <span className={cn(phase === "running" || phase === "repairing" ? "text-pp-sky" : "text-white/30")}>
              <LiveDot className="size-1.5" />
            </span>
            Verifier · @kept/core · running in your browser
          </p>
          {phase !== "idle" && (
            <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white">
              <RotateCcw className="size-3" /> Reset
            </button>
          )}
        </div>

        {phase === "idle" && (
          <div className="flex flex-1 flex-col justify-end gap-8">
            <div className="relative h-56 overflow-hidden rounded-2xl sm:h-64">
              <Photo src={PHOTOS.womanDesk} alt="A designer at her desk, the payee in this deal" sizes="(min-width: 1024px) 40vw, 100vw" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <p className="absolute bottom-4 left-4 right-4 text-sm text-white/85">The designer. She delivers on day 6. Will she get her $300?</p>
            </div>
            <p className="max-w-sm text-[1.625rem] leading-[1.2] tracking-[-0.04em]">
              Before anyone pays, Kept tries every order of events. <span className="text-white/40">Deliveries, reviews, deadlines, even two at the same instant.</span>
            </p>
            <div className="mt-8">
              <Button variant="inverse" size="lg" onClick={run}>
                Run the verifier on the draft
              </Button>
            </div>
          </div>
        )}

        {(phase === "running" || phase === "repairing") && (
          <div className="flex flex-1 flex-col items-start justify-center gap-4">
            <Spinner className="size-6 text-pp-sky" />
            <p className="text-lg tracking-[-0.03em]">{phase === "running" ? "Exploring every reachable state…" : "Checking the repaired rules…"}</p>
          </div>
        )}

        {report && (phase === "broken" || phase === "proved") && (
          <div className="mt-6 flex flex-1 flex-col">
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-white/50">
              <span className="tabular">{report.stats.states} states</span>
              <span className="tabular">{report.stats.transitions} transitions</span>
              <span className="tabular">{report.bounds.distinctOutcomes} outcomes</span>
              <span className="tabular">{report.stats.ms < 1 ? "<1" : Math.round(report.stats.ms)} ms</span>
            </div>
            <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
              {report.properties.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full", p.status === "proved" ? "bg-pp" : "bg-bad")}>
                    {p.status === "proved" ? <Check className="size-2.5" /> : <X className="size-2.5" />}
                  </span>
                  <span className={cn(p.status === "proved" ? "text-white/70" : "text-white")}>{p.title}</span>
                </li>
              ))}
            </ul>

            {phase === "broken" && violated?.counterexample && (
              <div className="mt-7">
                <p className="eyebrow text-white/40">Shortest way to break it</p>
                <ol className="mt-3 space-y-3">
                  {steps.slice(0, shown).map((s) => (
                    <li key={s.index} className="animate-rise rounded-2xl bg-white/[0.06] p-4">
                      <div className="flex items-start gap-3">
                        <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs">{s.index}</span>
                        <div className="min-w-0 flex-1 space-y-1 text-sm leading-relaxed text-white/80">
                          {s.narration.map((n) => (
                            <p key={n}>{n}</p>
                          ))}
                        </div>
                      </div>
                      <StackedBar
                        className="mt-3"
                        height="h-1.5"
                        total={PRINCIPAL}
                        segments={[
                          { label: "Released to the designer", value: s.releasedCents, className: "bg-pp-sky" },
                          { label: "Refunded to the client", value: s.refundedCents, className: "bg-white/45" },
                          { label: "Still held", value: s.heldCents, className: "bg-white/15" },
                        ]}
                      />
                      <p className="tabular mt-1.5 text-[11px] text-white/40">
                        held {formatCents(s.heldCents)} · designer {formatCents(s.releasedCents)} · client {formatCents(s.refundedCents)}
                      </p>
                    </li>
                  ))}
                </ol>
                {shown > steps.length && (
                  <div className="mt-5 animate-rise">
                    <div className="inline-block -rotate-1 rounded-xl border-2 border-white/70 px-4 py-2 text-white/75">
                      <p className="text-xs uppercase tracking-[0.12em]">Broken promise</p>
                      <p className="mt-0.5 max-w-md text-sm leading-snug text-white/85">The designer delivered on time and the deadline rule refunded her pay anyway: $100 of $300.</p>
                    </div>
                    <div className="mt-6">
                      <Button variant="inverse" onClick={repair} icon={<Sparkles className="size-4" />}>
                        Let Claude repair the rules
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {phase === "proved" && (
              <div className="mt-auto animate-rise pt-8">
                <p className="text-[1.625rem] leading-[1.2] tracking-[-0.04em]">
                  {report.summary} <span className="text-white/40">Only now can anyone fund it.</span>
                </p>
                <p className="tabular mt-3 text-sm text-white/50">
                  Designer gets {formatCents(report.bounds.payeeMinCents)} to {formatCents(report.bounds.payeeMaxCents)} · fee at most {formatCents(report.bounds.feeMaxCents)} · settled by hour {report.bounds.latestSettlementHours} · at most {report.bounds.maxPayPalCalls} PayPal calls
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
