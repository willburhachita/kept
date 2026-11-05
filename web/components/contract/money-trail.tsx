"use client";

import { formatCents, type Currency } from "@kept/core";
import { AllCommunityModule, themeQuartz, type CellValueChangedEvent, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import { useQuery } from "convex/react";
import { Download, RotateCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import { api, type Id } from "@/lib/convex";
import { errorMessage } from "@/lib/errors";
import { checkRows, classify, rehash, totals, withAmount, type RowCheck, type TrailRow } from "@/lib/money-trail";
import { fetchPublicKeys } from "@/lib/receipts";
import { cn } from "@/lib/utils";

const MODULES = [AllCommunityModule];

// Matches the site tokens: Inter, ink text, quiet greys, PayPal blue as the accent.
const theme = themeQuartz.withParams({
  fontFamily: "inherit",
  fontSize: 13,
  foregroundColor: "#0a0a0a",
  backgroundColor: "#ffffff",
  headerBackgroundColor: "#f5f5f5",
  headerFontWeight: 500,
  borderColor: "rgba(0,0,0,0.07)",
  accentColor: "#0070e0",
  rowHoverColor: "rgba(0,112,224,0.04)",
  wrapperBorderRadius: 16,
  spacing: 7,
});

const FLOW_LABEL: Record<NonNullable<TrailRow["flow"]>, string> = {
  in: "Payer → PayPal hold",
  captured: "Hold → captured",
  rule: "Rule moved",
  out: "Paid to payee",
  back: "Back to payer",
};

const WHY: Record<Extract<RowCheck, { state: "bad" }>["why"], string> = {
  content: "Edited: content no longer matches its hash",
  signature: "Re-hashed: Kept's signature no longer matches",
  link: "Link broken: an earlier entry changed",
  key: "Signed with an unknown key",
};

function actorLabel(actor: string): string {
  if (actor === "system") return "Kept engine";
  if (actor === "paypal") return "PayPal";
  if (actor.startsWith("user:")) return "A party";
  if (actor.startsWith("arbiter:")) return "Arbiter";
  if (actor.startsWith("agent:")) return "Agent";
  return actor;
}

type GridRow = TrailRow & { check: RowCheck; edited: boolean };
type TotalRow = { pinned: true; inCents: number; outCents: number; backCents: number };

function StatusCell({ data }: ICellRendererParams<GridRow | TotalRow>) {
  if (!data) return null;
  if ("pinned" in data) return <span className="text-xs text-muted">Totals recomputed from the rows above</span>;
  const c = data.check;
  if (c.state === "unchecked") return <span className="text-faint">Not checked yet</span>;
  if (c.state === "ok")
    return (
      <span className="inline-flex items-center gap-1.5 text-ok">
        <ShieldCheck className="size-3.5" /> Verified
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-bad">
      <ShieldAlert className="size-3.5" /> {WHY[c.why]}
    </span>
  );
}

/**
 * The money trail as a spreadsheet you can try to cheat. Every cell is editable; every
 * edit re-checks the hash chain and Ed25519 signatures in the browser, so a rewritten
 * history shows exactly where it was rewritten. Nothing is sent anywhere.
 */
export function MoneyTrail({ contractId, currency }: { contractId: Id<"contracts">; currency: Currency }) {
  const journal = useQuery(api.contracts.journal, { contractId, limit: 500 });
  const [keys, setKeys] = useState<Record<string, string> | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TrailRow[] | null>(null);
  const [coverTracks, setCoverTracks] = useState(false);
  const [filter, setFilter] = useState("");
  const sigCache = useRef(new Map<string, boolean>());
  const grid = useRef<AgGridReact<GridRow>>(null);

  const original = useMemo(() => journal?.map(classify) ?? null, [journal]);
  useEffect(() => {
    fetchPublicKeys()
      .then(setKeys)
      .catch((e) => setKeyError(errorMessage(e)));
  }, []);
  // New entries from the server reset any experiment: the live chain always wins.
  useEffect(() => setDraft(original), [original]);

  const rows: GridRow[] = useMemo(() => {
    if (!draft || !original) return [];
    const checks = checkRows(contractId, draft, keys, sigCache.current);
    return draft.map((r, i) => ({ ...r, check: checks[i], edited: r.hash !== original[i]?.hash || r.cents !== original[i]?.cents || r.type !== original[i]?.type }));
  }, [draft, original, keys, contractId]);

  const t = useMemo(() => totals(draft ?? []), [draft]);
  const pinned: TotalRow[] = [{ pinned: true, inCents: t.in, outCents: t.out, backCents: t.back }];
  const broken = rows.filter((r) => r.check.state === "bad");
  const tampered = rows.some((r) => r.edited);
  const firstBroken = broken[0]?.seq;
  const startsAtOne = !journal?.length || journal[0].seq === 1;
  const f = (c: number) => formatCents(c, currency);

  const columns = useMemo<ColDef<GridRow | TotalRow>[]>(
    () => [
      { headerName: "#", field: "seq" as never, width: 64, pinned: "left", sort: "asc", valueFormatter: (p) => (p.data && "pinned" in p.data ? "" : String(p.value)) },
      {
        headerName: "When",
        field: "at" as never,
        width: 150,
        valueFormatter: (p) => (p.data && "pinned" in p.data ? "" : new Date(p.value as number).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })),
      },
      { headerName: "Who", field: "actor" as never, width: 120, valueFormatter: (p) => (p.data && "pinned" in p.data ? "" : actorLabel(String(p.value))) },
      {
        headerName: "Event",
        field: "type" as never,
        flex: 1,
        minWidth: 180,
        editable: (p) => Boolean(p.data && !("pinned" in p.data)),
        cellClass: "font-mono text-[12px]",
        valueFormatter: (p) => (p.data && "pinned" in p.data ? "Money in / paid out / returned" : String(p.value)),
      },
      {
        headerName: "Money",
        colId: "money",
        width: 150,
        type: "rightAligned",
        editable: (p) => Boolean(p.data && !("pinned" in p.data) && (p.data as GridRow).amountField),
        valueGetter: (p) => (p.data && "pinned" in p.data ? null : (p.data as GridRow | undefined)?.cents ?? null),
        valueSetter: (p) => {
          const dollars = Number(String(p.newValue).replace(/[^0-9.]/g, ""));
          if (!Number.isFinite(dollars)) return false;
          (p.data as GridRow).cents = Math.round(dollars * 100);
          return true;
        },
        valueFormatter: (p) => {
          if (p.data && "pinned" in p.data) return `${f(p.data.inCents)} / ${f(p.data.outCents)} / ${f(p.data.backCents)}`;
          return p.value === null || p.value === undefined ? "" : f(p.value as number);
        },
        cellClass: "tabular",
      },
      { headerName: "Direction", colId: "flow", width: 170, valueGetter: (p) => (p.data && !("pinned" in p.data) && (p.data as GridRow).flow ? FLOW_LABEL[(p.data as GridRow).flow!] : "") },
      { headerName: "Hash", field: "hash" as never, width: 130, cellClass: "font-mono text-[12px] text-muted", valueFormatter: (p) => (p.value ? `${String(p.value).slice(0, 12)}…` : "") },
      { headerName: "Check", colId: "check", minWidth: 290, flex: 1, cellRenderer: StatusCell, sortable: false },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currency],
  );

  function onEdit(e: CellValueChangedEvent<GridRow | TotalRow>) {
    if (!draft || !e.data || "pinned" in e.data) return;
    const row = e.data as GridRow;
    setDraft((d) =>
      (d ?? []).map((r) => {
        if (r.seq !== row.seq) return r;
        let next: TrailRow = e.colDef.colId === "money" && row.cents !== null ? withAmount(r, row.cents) : { ...r, type: row.type };
        if (coverTracks) next = rehash(contractId, next);
        return next;
      }),
    );
  }

  if (journal === undefined || !draft) return <Skeleton className="h-96 rounded-card" />;
  return (
    <Card>
      <CardHeader
        eyebrow="Money trail"
        title="Try to rewrite the history"
        action={
          <div className="flex gap-1.5">
            {tampered && (
              <Button size="sm" variant="secondary" onClick={() => setDraft(original)} icon={<RotateCcw className="size-3.5" />}>
                Undo my edits
              </Button>
            )}
            <Button size="sm" variant="ghost" aria-label="Download as CSV" onClick={() => grid.current?.api.exportDataAsCsv({ fileName: `kept-money-trail-${contractId}.csv` })} icon={<Download className="size-3.5" />} />
          </div>
        }
      />
      <p className="-mt-2 mb-4 max-w-2xl text-sm text-muted">
        Every row is a signed entry in this promise&apos;s history. Double-click an amount or an event and change it, the way someone faking a payment record would. Your browser re-checks every hash, link and signature against Kept&apos;s
        published key. Nothing you type leaves this page.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter rows (try “paypal”)"
          aria-label="Filter the money trail"
          className="h-9 w-full max-w-xs rounded-full bg-black/[0.05] px-4 text-sm outline-none placeholder:text-faint focus:bg-black/[0.07]"
        />
        <label className="inline-flex cursor-pointer select-none items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={coverTracks} onChange={(e) => setCoverTracks(e.target.checked)} className="size-4 accent-[#0070e0]" />
          Cover my tracks (recompute the hash after each edit, like a real attacker)
        </label>
      </div>
      {keyError && <Notice tone="bad" className="mb-4">{keyError}</Notice>}
      {!startsAtOne && <Notice className="mb-4">This promise has more than 500 entries; only the latest are shown, so links can&apos;t be checked from the first entry.</Notice>}
      <Notice tone={!keys ? "neutral" : broken.length ? "bad" : "ok"} className="mb-4" title={!keys ? "Loading Kept's public key…" : broken.length ? `History rewritten at entry #${firstBroken}: ${broken.length} of ${rows.length} entries now fail` : `All ${rows.length} entries verified`}>
        {!keys
          ? "Signatures are checked against the key Kept publishes, not one this page was given."
          : broken.length
            ? coverTracks
              ? "Recomputing the hash makes the edited entry look consistent, but only Kept's private key can sign the new hash, and every later entry still points at the old one."
              : "The edited entry no longer matches the hash Kept signed. Turn on “Cover my tracks” to see why recomputing the hash doesn't help either."
            : tampered
              ? "Your edits were undone or changed nothing."
              : "Every hash recomputed, every link followed from the first entry, every Ed25519 signature checked in your browser."}
      </Notice>
      <AgGridProvider modules={MODULES}>
        <div className={cn("h-[460px] w-full", broken.length && "[&_.kept-bad]:bg-[rgba(0,0,0,0.035)]")}>
          <AgGridReact<GridRow | TotalRow>
            ref={grid as never}
            theme={theme}
            rowData={rows}
            pinnedBottomRowData={pinned}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
            getRowId={(p) => ("pinned" in p.data ? "totals" : String((p.data as GridRow).seq))}
            rowClassRules={{ "kept-bad": (p) => Boolean(p.data && !("pinned" in p.data) && (p.data as GridRow).check.state === "bad") }}
            quickFilterText={filter}
            singleClickEdit={false}
            stopEditingWhenCellsLoseFocus
            onCellValueChanged={onEdit}
          />
        </div>
      </AgGridProvider>
    </Card>
  );
}
