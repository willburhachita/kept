import { evaluateSpend, type MandatePolicy, type MandateRuntime, type SpendDecision } from "@kept/core";

export interface PastSpend {
  id: string;
  createdAt: number;
  status: string;
  merchantName: string;
  merchantEmail: string;
  amountCents: number;
  description: string;
}

export interface Replayed extends PastSpend {
  /** What the edited policy decides, given everything it would have allowed before. */
  decision: SpendDecision;
  reasons: string[];
  /** What actually happened, collapsed to the same three outcomes. */
  actual: SpendDecision;
  changed: boolean;
}

const OUTCOME: Record<string, SpendDecision> = { paid: "approve", executing: "approve", failed: "approve", needs_approval: "needs_approval", denied: "deny", cancelled: "deny", screening: "approve" };

/**
 * Replay a mandate's real purchase history, oldest first, through the same guard the
 * backend runs (`evaluateSpend`), but with an edited policy. Budget, purchase count and
 * velocity accumulate from what the edited policy would have let through. A purchase that
 * would need approval counts as spent only if it was approved in reality.
 * The AI purpose screen is not replayed: it only ever escalates, never approves.
 */
export function backtest(policy: MandatePolicy, activatedAt: number | null, feeBps: number, history: PastSpend[]): Replayed[] {
  const rt: MandateRuntime = { status: "active", activatedAt, spentCents: 0, reservedCents: 0, purchases: 0, recentSpendTimes: [] };
  return [...history]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((s) => {
      const ev = evaluateSpend(policy, rt, { amountCents: s.amountCents, currency: policy.currency, merchantEmail: s.merchantEmail, description: s.description || "purchase" }, s.createdAt, feeBps);
      const actual = OUTCOME[s.status] ?? "deny";
      const counts = ev.decision === "approve" || (ev.decision === "needs_approval" && (s.status === "paid" || s.status === "executing"));
      if (counts) {
        rt.spentCents += s.amountCents;
        rt.purchases += 1;
        rt.recentSpendTimes.push(s.createdAt);
      }
      return { ...s, decision: ev.decision, reasons: ev.reasons, actual, changed: ev.decision !== actual };
    });
}
