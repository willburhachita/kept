"use client";

import { formatCents, type Currency } from "@kept/core";
import { Card, CardHeader } from "@/components/ui/card";
import { StackedBar } from "@/components/ui/misc";
import { Countdown } from "@/components/ui/time";
import type { ContractView } from "@/lib/convex";
import { dateTime } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { cn } from "@/lib/utils";

type View = NonNullable<ContractView>;

/**
 * Two layers: what the contract decided (held, released, returned, fees) above
 * what PayPal has confirmed (captured, paid out, voided, refunded).
 */
export function MoneyRiver({ c }: { c: View }) {
  const L = c.ledger;
  const cur = (c.ir?.currency ?? "USD") as Currency;
  const f = (n: number) => formatCents(n, cur);
  const decided = [
    { label: "Released to the payee", value: L.releasedCents, swatch: "bg-ink" },
    { label: "Returned to the payer", value: L.refundedCents, swatch: "bg-faint" },
    { label: "Still held", value: L.heldCents, swatch: "bg-pp" },
  ];
  const paypal = [
    ["Captured", L.capturedCents],
    ["Paid out", L.paidOutCents],
    ["Hold voided", L.voidedCents],
    ["Refunds sent", L.refundExecutedCents],
  ] as const;
  return (
    <Card>
      <CardHeader eyebrow="Where every cent is" title={`${f(L.principalCents)} promise`} />
      <StackedBar total={L.principalCents} height="h-4" segments={decided.map((d) => ({ label: d.label, value: d.value, className: d.swatch }))} />
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {decided.map((d) => (
          <div key={d.label}>
            <dt className="flex items-center gap-2 text-xs text-muted">
              <span className={cn("size-2 rounded-full", d.swatch)} /> {d.label}
            </dt>
            <dd className="tabular mt-1 text-xl tracking-[-0.04em]">{f(d.value)}</dd>
          </div>
        ))}
        <div>
          <dt className="text-xs text-muted">Kept fee so far</dt>
          <dd className="tabular mt-1 text-xl tracking-[-0.04em]">{f(L.feesCents)}</dd>
        </div>
      </dl>
      <div className="mt-6 border-t border-line pt-4">
        <p className="eyebrow mb-3">Confirmed by PayPal</p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {paypal.map(([label, v]) => (
            <div key={label}>
              <dt className="text-xs text-faint">{label}</dt>
              <dd className="tabular text-sm text-ink-2">{f(v)}</dd>
            </div>
          ))}
        </dl>
        {c.funding && (
          <p className="mt-4 text-xs leading-relaxed text-muted">
            {c.funding.runtimeMode === "authorize" ? "Held as a PayPal authorization" : "Held in escrow on PayPal"} of {f(c.funding.authorizationCents)} (includes up to {f(c.funding.maxFeeCents)} in fees).
            {c.funding.honorEndsAt && c.funding.runtimeMode === "authorize" ? ` Honor period ends ${dateTime(c.funding.honorEndsAt)}.` : ""}
            {c.funding.expiresAt && c.funding.runtimeMode === "authorize" ? ` Authorization valid until ${dateTime(c.funding.expiresAt)}; Kept secures the money before then.` : ""}
          </p>
        )}
      </div>
    </Card>
  );
}

/** Deadlines on a ruler from the start of the contract, with a moving "now" marker. */
export function DeadlineRuler({ c }: { c: View }) {
  const now = useNow(30_000);
  const start = c.activatedAt;
  const ds = c.deadlines;
  if (!ds.length) return null;
  const last = Math.max(...ds.map((d) => d.at ?? 0));
  const span = start && last > start ? last - start : 0;
  const pos = (t: number) => (span ? Math.min(100, Math.max(0, ((t - start!) / span) * 100)) : 0);
  return (
    <Card>
      <CardHeader eyebrow="Deadlines" title={c.nextDeadline ? <>Next: {c.nextDeadline.label}</> : "No deadlines left"} />
      {span > 0 && (
        <div className="relative mb-8 mt-2 h-10">
          <div className="absolute inset-x-0 top-1/2 h-px bg-line-2" />
          <div className="absolute top-1/2 h-px bg-ink" style={{ width: `${pos(now)}%` }} />
          <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" style={{ left: "0%" }} />
          {ds.map((d) =>
            d.at ? (
              <span key={d.id} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pos(d.at)}%` }}>
                <span className={cn("block size-3 rotate-45 border-2", d.passed ? "border-ink bg-ink" : "border-ink bg-surface")} />
              </span>
            ) : null,
          )}
          <span className="absolute -top-1 -translate-x-1/2 text-[10px] uppercase tracking-wide text-pp" style={{ left: `${pos(now)}%` }}>
            now
          </span>
        </div>
      )}
      <ul className="space-y-2.5">
        {ds.map((d) => (
          <li key={d.id} className="flex items-baseline justify-between gap-4 text-sm">
            <span className={cn(d.passed ? "text-muted line-through decoration-faint" : "text-ink")}>{d.label}</span>
            <span className="tabular shrink-0 text-right text-muted">
              {d.at ? (
                <>
                  {dateTime(d.at)} · {d.passed ? "passed" : <Countdown to={d.at} parts={2} />}
                </>
              ) : (
                `${d.afterHours}h after funding`
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
