"use client";

import { formatCents, type Currency, type VerificationReport } from "@kept/core";
import { Check, ChevronLeft, ChevronRight, Play, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Chip } from "@/components/ui/chip";
import { StackedBar } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

/** Header chips: every number the verifier derived before anything runs. */
export function BoundsChips({ report, currency }: { report: VerificationReport; currency: Currency }) {
  const b = report.bounds;
  const f = (c: number) => formatCents(c, currency);
  const range = (lo: number, hi: number) => (lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`);
  return (
    <div className="flex flex-wrap gap-1.5">
      <Chip tone="neutral">Payee gets {range(b.payeeMinCents, b.payeeMaxCents)}</Chip>
      <Chip tone="neutral">Payer gets back {range(b.funderMinCents, b.funderMaxCents)}</Chip>
      <Chip tone="neutral">Fee {range(b.feeMinCents, b.feeMaxCents)}</Chip>
      <Chip tone="neutral">Settled by hour {b.latestSettlementHours}</Chip>
      <Chip tone="neutral">≤ {b.maxPayPalCalls} PayPal calls</Chip>
      <Chip tone="neutral">{b.distinctOutcomes} possible endings</Chip>
    </div>
  );
}

/** Plays a counterexample like a story: numbered beats, a money bar per beat, the outcome stamp. */
export function CounterexamplePlayer({ report, propertyId, currency, principalCents, dark }: { report: VerificationReport; propertyId: string; currency: Currency; principalCents: number; dark?: boolean }) {
  const prop = report.properties.find((p) => p.id === propertyId);
  const steps = prop?.counterexample?.steps ?? [];
  const [at, setAt] = useState(steps.length);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (at >= steps.length) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setAt((n) => n + 1), 1000);
    return () => clearTimeout(id);
  }, [playing, at, steps.length]);
  if (!prop?.counterexample) return null;
  const f = (c: number) => formatCents(c, currency);
  return (
    <div className={cn("rounded-2xl p-5", dark ? "bg-white/[0.06] text-white" : "bg-bad-tint/60")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={cn("text-sm font-medium", dark ? "text-white" : "text-bad")}>How &ldquo;{prop.title}&rdquo; breaks</p>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous step" onClick={() => setAt((n) => Math.max(0, n - 1))} className="inline-flex size-7 items-center justify-center rounded-full hover:bg-black/5">
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setAt(0);
              setPlaying(true);
            }}
            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-ink px-3 text-xs text-white"
          >
            <Play className="size-3" /> Play
          </button>
          <button type="button" aria-label="Next step" onClick={() => setAt((n) => Math.min(steps.length, n + 1))} className="inline-flex size-7 items-center justify-center rounded-full hover:bg-black/5">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <ol className="mt-4 space-y-2.5">
        {steps.slice(0, at).map((s) => (
          <li key={s.index} className={cn("animate-rise rounded-xl p-3.5", dark ? "bg-white/[0.06]" : "bg-surface")}>
            <div className="flex gap-3">
              <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs text-white">{s.index}</span>
              <div className="min-w-0 space-y-0.5 text-sm leading-relaxed">
                {s.narration.map((n) => (
                  <p key={n}>{n}</p>
                ))}
              </div>
            </div>
            <StackedBar
              className="mt-3"
              height="h-1.5"
              total={principalCents}
              segments={[
                { label: "Released to the payee", value: s.releasedCents, className: "bg-pp" },
                { label: "Refunded to the payer", value: s.refundedCents, className: "bg-faint" },
                { label: "Still held", value: s.heldCents, className: "bg-black/15" },
              ]}
            />
            <p className="tabular mt-1.5 text-[11px] text-muted">
              held {f(s.heldCents)} · payee {f(s.releasedCents)} · payer {f(s.refundedCents)}
            </p>
          </li>
        ))}
      </ol>
      {at >= steps.length && <p className="mt-4 border-l-2 border-bad pl-3 text-sm leading-relaxed text-bad">{prop.counterexample.outcome}</p>}
    </div>
  );
}

/** The verifier's verdict on these terms: properties, counterexamples, endings and bounds. */
export function ReportView({ report, currency, principalCents }: { report: VerificationReport; currency: Currency; principalCents: number }) {
  const f = (c: number) => formatCents(c, currency);
  const violated = report.properties.filter((p) => p.status === "violated" && p.counterexample);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={cn("text-lg tracking-[-0.03em]", report.ok ? "text-ok" : "text-bad")}>{report.summary}</p>
          <p className="tabular mt-1 text-xs text-muted">
            {report.stats.states.toLocaleString()} states · {report.stats.transitions.toLocaleString()} transitions · {report.stats.ms < 1 ? "<1" : Math.round(report.stats.ms)} ms · engine {report.engineVersion}
            {report.stats.truncated && " · search was truncated"}
          </p>
        </div>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {report.properties.map((p) => (
          <li key={p.id} className="flex items-start gap-3 rounded-2xl bg-sunken px-4 py-3">
            <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-white", p.status === "proved" ? "bg-ok" : p.severity === "warning" ? "bg-warn" : "bg-bad")}>
              {p.status === "proved" ? <Check className="size-3" /> : <X className="size-3" />}
            </span>
            <div className="min-w-0">
              <p className="text-sm text-ink">{p.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{p.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      {violated.map((p) => (
        <CounterexamplePlayer key={p.id} report={report} propertyId={p.id} currency={currency} principalCents={principalCents} />
      ))}
      <div>
        <p className="eyebrow mb-3">Every way this can end</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {report.outcomes.map((o) => (
            <div key={o.id} className="rounded-2xl border border-line p-4">
              <p className="text-sm leading-relaxed text-ink-2">{o.description}</p>
              <div className="tabular mt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-faint">Payee</p>
                  <p className="text-ink">{f(o.payeeCents)}</p>
                </div>
                <div>
                  <p className="text-faint">Payer back</p>
                  <p className="text-ink">{f(o.funderCents)}</p>
                </div>
                <div>
                  <p className="text-faint">Fee</p>
                  <p className="text-ink">{f(o.feeCents)}</p>
                </div>
              </div>
              {o.stuckCents > 0 && <p className="mt-2 text-xs text-bad">{f(o.stuckCents)} would be stuck</p>}
              {o.example.length > 0 && (
                <details className="mt-3 text-xs text-muted">
                  <summary className="cursor-pointer text-pp">Show how</summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-4">
                    {o.example.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          ))}
        </div>
      </div>
      <BoundsChips report={report} currency={currency} />
    </div>
  );
}
