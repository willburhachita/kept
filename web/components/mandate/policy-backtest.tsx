"use client";

import { formatCents, type MandatePolicy, type SpendDecision } from "@kept/core";
import { AllCommunityModule, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import { useQuery } from "convex/react";
import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import { backtest, type Replayed } from "@/lib/backtest";
import { api, type Id } from "@/lib/convex";
import { cn } from "@/lib/utils";

const MODULES = [AllCommunityModule];
const theme = themeQuartz.withParams({
  fontFamily: "inherit",
  fontSize: 13,
  foregroundColor: "#0a0a0a",
  backgroundColor: "#ffffff",
  headerBackgroundColor: "#f5f5f5",
  headerFontWeight: 500,
  borderColor: "rgba(0,0,0,0.07)",
  accentColor: "#0070e0",
  wrapperBorderRadius: 16,
  spacing: 7,
});

const LABEL: Record<SpendDecision, string> = { approve: "Allowed", needs_approval: "Asks you", deny: "Blocked" };

function Outcome({ value }: ICellRendererParams<Replayed, SpendDecision>) {
  if (!value) return null;
  return (
    <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs", value === "approve" ? "bg-pp/10 text-pp-deep" : value === "needs_approval" ? "bg-black/[0.06] text-ink" : "bg-ink text-white")}>{LABEL[value]}</span>
  );
}

interface Limits {
  perPurchase: string;
  approvalAbove: string;
  maxPerHour: string;
  merchants: string;
}

const toLimits = (p: MandatePolicy): Limits => ({
  perPurchase: String(p.perPurchaseMaxCents / 100),
  approvalAbove: p.approvalAboveCents === null ? "" : String(p.approvalAboveCents / 100),
  maxPerHour: String(p.maxPerHour),
  merchants: p.allowedMerchants.join(", "),
});

/**
 * Policy backtest: edit the budget's limits and replay every purchase the agent really
 * asked for through the same guard Kept runs, to see what the new rules would have
 * allowed, escalated or blocked. Nothing is saved: the live policy is fixed once funded.
 */
export function PolicyBacktest({ mandateId, policy, activatedAt, feeBps }: { mandateId: Id<"mandates">; policy: MandatePolicy; activatedAt: number | null; feeBps: number }) {
  const spends = useQuery(api.mandates.spends, { mandateId });
  const [limits, setLimits] = useState<Limits>(() => toLimits(policy));
  const set = (k: keyof Limits) => (e: { target: { value: string } }) => setLimits((l) => ({ ...l, [k]: e.target.value }));
  const f = (c: number) => formatCents(c, policy.currency);

  const edited: MandatePolicy = useMemo(() => {
    const cents = (s: string, fallback: number) => (Number.isFinite(Number(s)) && s.trim() !== "" ? Math.round(Number(s) * 100) : fallback);
    return {
      ...policy,
      perPurchaseMaxCents: cents(limits.perPurchase, policy.perPurchaseMaxCents),
      approvalAboveCents: limits.approvalAbove.trim() === "" ? null : cents(limits.approvalAbove, policy.approvalAboveCents ?? 0),
      maxPerHour: Math.max(1, Math.round(Number(limits.maxPerHour) || policy.maxPerHour)),
      allowedMerchants: limits.merchants
        .split(/[,\n]/)
        .map((m) => m.trim().toLowerCase())
        .filter(Boolean),
    };
  }, [limits, policy]);

  const rows = useMemo(
    () => (spends ? backtest(edited, activatedAt, feeBps, spends.map((s) => ({ id: s._id, createdAt: s.createdAt, status: s.status, merchantName: s.merchantName, merchantEmail: s.merchantEmail, amountCents: s.amountCents, description: s.description }))) : []),
    [spends, edited, activatedAt, feeBps],
  );
  const nowBlocked = rows.filter((r) => r.decision === "deny" && r.actual !== "deny");
  const nowAsks = rows.filter((r) => r.decision === "needs_approval" && r.actual === "approve");
  const nowAllowed = rows.filter((r) => r.decision === "approve" && r.actual !== "approve");
  const dirty = JSON.stringify(limits) !== JSON.stringify(toLimits(policy));

  const columns = useMemo<ColDef<Replayed>[]>(
    () => [
      { headerName: "When", field: "createdAt", width: 140, sort: "asc", valueFormatter: (p) => new Date(p.value as number).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) },
      { headerName: "Merchant", field: "merchantName", width: 150 },
      { headerName: "Paid to", field: "merchantEmail", width: 200, cellClass: "text-muted" },
      { headerName: "What", field: "description", flex: 1, minWidth: 180 },
      { headerName: "Amount", field: "amountCents", width: 110, type: "rightAligned", cellClass: "tabular", valueFormatter: (p) => f(p.value as number) },
      { headerName: "What happened", field: "actual", width: 140, cellRenderer: Outcome },
      { headerName: "Under these rules", field: "decision", width: 160, cellRenderer: Outcome },
      { headerName: "Why", field: "reasons", flex: 1, minWidth: 240, cellClass: "text-muted", valueFormatter: (p) => (p.value as string[]).join(" · "), tooltipValueGetter: (p) => (p.value as string[]).join("\n") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [policy.currency],
  );

  return (
    <Card>
      <CardHeader
        eyebrow="Policy backtest"
        title="What if the rules had been stricter?"
        action={
          dirty && (
            <Button size="sm" variant="secondary" onClick={() => setLimits(toLimits(policy))} icon={<RotateCcw className="size-3.5" />}>
              Back to the real rules
            </Button>
          )
        }
      />
      <p className="-mt-2 mb-4 max-w-2xl text-sm text-muted">
        Change a limit and every purchase your agent really asked for is replayed, in order, through the same check Kept runs on each request. Use it to tune the next budget. The live rules can&apos;t change once the money is on hold.
      </p>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <label className="text-xs text-muted">
          Most per purchase ($)
          <Input inputMode="decimal" value={limits.perPurchase} onChange={set("perPurchase")} className="mt-1" />
        </label>
        <label className="text-xs text-muted">
          Ask me above ($)
          <Input inputMode="decimal" value={limits.approvalAbove} onChange={set("approvalAbove")} placeholder="Never ask" className="mt-1" />
        </label>
        <label className="text-xs text-muted">
          Purchases per hour
          <Input inputMode="numeric" value={limits.maxPerHour} onChange={set("maxPerHour")} className="mt-1" />
        </label>
        <label className="text-xs text-muted">
          Only these merchants
          <Input value={limits.merchants} onChange={set("merchants")} placeholder="Any merchant" className="mt-1" />
        </label>
      </div>
      {spends === undefined ? (
        <Skeleton className="h-64" />
      ) : spends.length === 0 ? (
        <p className="text-sm text-muted">No purchases yet. Once your agent buys something, you can replay its history here under different rules.</p>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            {[
              { n: nowBlocked.length, label: "would have been blocked", sub: nowBlocked.length ? `${f(nowBlocked.reduce((s, r) => s + r.amountCents, 0))} not spent` : "nothing changes" },
              { n: nowAsks.length, label: "would have asked you first", sub: nowAsks.length ? `${f(nowAsks.reduce((s, r) => s + r.amountCents, 0))} waiting on you` : "no extra approvals" },
              { n: nowAllowed.length, label: "would now go through", sub: nowAllowed.length ? `${f(nowAllowed.reduce((s, r) => s + r.amountCents, 0))} more spent` : "nothing newly allowed" },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl bg-sunken px-4 py-3">
                <p className="text-sm text-ink">
                  <span className="tabular text-2xl tracking-[-0.04em]">{s.n}</span> {s.label}
                </p>
                <p className="tabular text-xs text-muted">{s.sub}</p>
              </div>
            ))}
          </div>
          <AgGridProvider modules={MODULES}>
            <div className="h-[380px] w-full [&_.kept-changed]:bg-[rgba(0,112,224,0.06)]">
              <AgGridReact<Replayed>
                theme={theme}
                rowData={rows}
                columnDefs={columns}
                defaultColDef={{ sortable: true, resizable: true, suppressMovable: true, filter: true }}
                getRowId={(p) => p.data.id}
                rowClassRules={{ "kept-changed": (p) => Boolean(p.data?.changed) }}
                tooltipShowDelay={300}
              />
            </div>
          </AgGridProvider>
        </>
      )}
    </Card>
  );
}
