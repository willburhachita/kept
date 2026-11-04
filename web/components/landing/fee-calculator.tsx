"use client";

import { DEFAULT_FEE_BPS, authorizationAmount, feeOnCumulative, formatCents, maxFee } from "@kept/core";
import { useState } from "react";
import { cn } from "@/lib/utils";

const SCENARIOS = [
  { id: "all", label: "Everything released", released: 1 },
  { id: "half", label: "Half released, half returned", released: 0.5 },
  { id: "none", label: "Everything returned", released: 0 },
] as const;

/** Every number about a deal's money, before it exists. */
export function FeeCalculator() {
  const [dollars, setDollars] = useState(300);
  const [scenario, setScenario] = useState<(typeof SCENARIOS)[number]["id"]>("all");
  const cents = dollars * 100;
  const hold = authorizationAmount(cents, DEFAULT_FEE_BPS);
  const cap = maxFee(cents, DEFAULT_FEE_BPS);
  const s = SCENARIOS.find((x) => x.id === scenario)!;
  const released = Math.round(cents * s.released);
  const fee = feeOnCumulative(released, DEFAULT_FEE_BPS);
  const returned = cents - released;
  const charged = released + fee;

  return (
    <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
      <div className="rounded-card bg-surface p-6 sm:p-8">
        <label htmlFor="deal-amount" className="text-sm text-muted">
          Deal amount
        </label>
        <p className="tabular mt-1 text-[clamp(2.75rem,6vw,4rem)] leading-none tracking-[-0.06em]">{formatCents(cents)}</p>
        <input
          id="deal-amount"
          type="range"
          min={20}
          max={5000}
          step={10}
          value={dollars}
          onChange={(e) => setDollars(Number(e.target.value))}
          className="mt-6 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-black/10 accent-ink"
        />
        <div className="tabular mt-2 flex justify-between text-xs text-faint">
          <span>$20</span>
          <span>$5,000</span>
        </div>
        <div className="mt-8 flex flex-wrap gap-2" role="radiogroup" aria-label="Outcome">
          {SCENARIOS.map((x) => (
            <button
              key={x.id}
              type="button"
              role="radio"
              aria-checked={scenario === x.id}
              onClick={() => setScenario(x.id)}
              className={cn("rounded-full px-3.5 py-2 text-sm transition-colors", scenario === x.id ? "bg-ink text-white" : "bg-black/[0.05] text-muted hover:text-ink")}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>
      <dl className="rounded-card bg-ink p-6 text-white sm:p-8">
        {[
          ["PayPal hold when you fund", formatCents(hold), `${formatCents(cents)} plus the most the fee could ever be (${formatCents(cap)})`],
          ["Paid to the other side", formatCents(released), "Straight to their PayPal, as each promise is kept"],
          ["Returned to you", formatCents(returned), "Voided or refunded. Kept charges nothing on it"],
          ["Kept's fee", formatCents(fee), `${(DEFAULT_FEE_BPS / 100).toFixed(1)}% of released money only`],
          ["Total that leaves your PayPal", formatCents(charged), "The rest of the hold simply drops off"],
        ].map(([label, value, hint], i) => (
          <div key={label} className={cn("flex items-baseline justify-between gap-6 py-3.5", i > 0 && "border-t border-white/10")}>
            <dt>
              <span className="text-sm text-white/80">{label}</span>
              <span className="mt-0.5 block text-xs text-white/40">{hint}</span>
            </dt>
            <dd className={cn("tabular shrink-0 text-right tracking-[-0.03em]", i === 4 ? "text-2xl" : "text-lg")}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
