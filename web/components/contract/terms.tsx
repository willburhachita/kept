"use client";

import type { VerificationReport } from "@kept/core";
import { Check, X } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import type { ContractView } from "@/lib/convex";
import { cn } from "@/lib/utils";

type View = NonNullable<ContractView>;

/** The terms as people sign them: promises big and plain, then rules, money, deadlines, deliverables. */
export function TermsCard({ c, compact }: { c: View; compact?: boolean }) {
  const r = c.rendered;
  if (!r || !c.ir) return null;
  const report = c.verification?.report as VerificationReport | undefined;
  const status = (gid: string) => report?.properties.find((p) => p.id === `promise:${gid}`)?.status;
  return (
    <Card>
      <CardHeader eyebrow="The terms" title={r.title} />
      <p className="-mt-2 mb-6 text-[15px] leading-relaxed text-muted">{r.summary}</p>

      <p className="eyebrow mb-3">Promises</p>
      <ul className="space-y-2">
        {c.ir.guarantees.map((g, i) => {
          const s = status(g.id);
          return (
            <li key={g.id} className={cn("rounded-2xl p-4", s === "violated" ? "bg-bad-tint" : "bg-sunken")}>
              <div className="flex items-start gap-3">
                <span className={cn("mt-1 flex size-5 shrink-0 items-center justify-center rounded-full text-white", s === "proved" ? "bg-ok" : s === "violated" ? "bg-bad" : "bg-line-2")}>
                  {s === "violated" ? <X className="size-3" /> : <Check className="size-3" />}
                </span>
                <div>
                  <p className="text-[17px] leading-snug tracking-[-0.03em] text-ink">{g.label}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{r.promises[i]}</p>
                  {s && <p className={cn("mt-1.5 text-xs", s === "proved" ? "text-ok" : "text-bad")}>{s === "proved" ? "Proved on every outcome it covers" : "Broken on at least one outcome"}</p>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {!compact && (
        <div className="mt-8 grid gap-8 md:grid-cols-2">
          <div>
            <p className="eyebrow mb-3">Rules (when money moves)</p>
            <ol className="space-y-2.5">
              {r.rules.map((x, i) => (
                <li key={x} className="flex gap-3 text-sm leading-relaxed text-ink-2">
                  <span className="tabular w-5 shrink-0 text-xs text-faint">{String(i + 1).padStart(2, "0")}</span>
                  {x}
                </li>
              ))}
            </ol>
          </div>
          <div className="space-y-6">
            {[
              ["Money", r.money],
              ["Deadlines", r.deadlines],
              ["Deliverables", r.evidence],
            ].map(([label, lines]) =>
              (lines as string[]).length ? (
                <div key={label as string}>
                  <p className="eyebrow mb-2">{label as string}</p>
                  <ul className="space-y-1.5 text-sm leading-relaxed text-ink-2">
                    {(lines as string[]).map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </div>
        </div>
      )}
      <details className="mt-6 text-sm">
        <summary className="cursor-pointer text-muted hover:text-ink">The original words</summary>
        <p className="mt-2 whitespace-pre-wrap rounded-xl bg-sunken p-3 text-ink-2">{c.prompt}</p>
      </details>
    </Card>
  );
}
