"use client";

import { useQuery } from "convex/react";
import { Check, Download, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Hash } from "@/components/ui/copy";
import { Notice } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import { RelativeTime } from "@/components/ui/time";
import { api, type Id } from "@/lib/convex";
import { errorMessage } from "@/lib/errors";
import { fetchPublicKeys, verifyJournal, type JournalVerification } from "@/lib/receipts";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

/** "funding.order_created" -> "Funding · order created". */
function label(type: string): string {
  const [head, ...rest] = type.split(".");
  const h = (head ?? type).replace(/_/g, " ");
  return rest.length ? `${h.charAt(0).toUpperCase()}${h.slice(1)} · ${rest.join(" ").replace(/_/g, " ")}` : h;
}

function actorLabel(actor: string): string {
  if (actor === "system") return "Kept engine";
  if (actor === "paypal") return "PayPal";
  if (actor.startsWith("user:")) return "A party";
  if (actor.startsWith("arbiter:")) return "Arbiter";
  if (actor.startsWith("agent:")) return "Agent";
  return actor;
}

/** The signed, hash-chained history, verifiable in the browser against the published keys. */
export function ReceiptChain({ contractId }: { contractId: Id<"contracts"> }) {
  const rows = useQuery(api.contracts.journal, { contractId, limit: 500 });
  const [all, setAll] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<JournalVerification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const proof = useQuery(api.contracts.proof, downloading ? { contractId } : "skip");

  useEffect(() => {
    if (!downloading || !proof) return;
    const blob = new Blob([JSON.stringify(proof, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kept-proof-${contractId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setDownloading(false);
  }, [downloading, proof, contractId]);

  async function verify() {
    if (!rows) return;
    setChecking(true);
    setError(null);
    try {
      const keys = await fetchPublicKeys();
      setResult(verifyJournal(contractId, rows, keys));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setChecking(false);
    }
  }

  const list = rows ? [...rows].reverse() : [];
  const shown = all ? list : list.slice(0, 8);
  return (
    <Card>
      <CardHeader
        eyebrow="Signed receipts"
        title={rows ? `${rows.length} entries, hash-chained` : "Receipts"}
        action={
          <div className="flex gap-1.5">
            <Button size="sm" variant="secondary" loading={checking} onClick={verify} icon={<ShieldCheck className="size-3.5" />}>
              Verify in browser
            </Button>
            <Button size="sm" variant="ghost" loading={downloading && !proof} onClick={() => setDownloading(true)} aria-label="Download the proof pack" icon={<Download className="size-3.5" />} />
          </div>
        }
      />
      {result && (
        <Notice tone={result.ok ? "ok" : "bad"} className="mb-4" title={result.ok ? `All ${result.checked} entries verified` : `Verification failed at entry ${result.failedAt}`}>
          {result.ok ? (
            <>
              Every hash recomputed, every link followed from the first entry, every Ed25519 signature checked against{" "}
              <a href={site.keysUrl} target="_blank" rel="noopener noreferrer" className="underline">
                the published key
              </a>{" "}
              ({result.keyIds.join(", ")}). Nobody, including Kept, can change this history without it showing.
            </>
          ) : (
            result.reason
          )}
        </Notice>
      )}
      {error && <Notice tone="bad" className="mb-4">{error}</Notice>}
      {rows === undefined ? (
        <Skeleton className="h-40" />
      ) : (
        <ol className="relative space-y-1">
          <span aria-hidden="true" className="absolute bottom-4 left-[9px] top-4 w-px bg-line" />
          {shown.map((e) => {
            const ok = result?.perEntry[e.seq];
            return (
              <li key={e.seq} className="relative flex gap-3 py-1.5">
                <span
                  className={cn(
                    "relative z-10 mt-1 flex size-[19px] shrink-0 items-center justify-center rounded-full border text-[9px]",
                    ok === true ? "border-ok bg-ok text-white" : ok === false ? "border-bad bg-bad text-white" : "border-line-2 bg-surface text-faint",
                  )}
                >
                  {ok === true ? <Check className="size-2.5" /> : ok === false ? <X className="size-2.5" /> : e.seq}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-sm text-ink">{label(e.type)}</p>
                    <RelativeTime at={e.at} className="text-xs text-faint" />
                  </div>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span>{actorLabel(e.actor)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center">
                      #{e.seq} <Hash value={e.hash} chars={12} className="ml-1" />
                    </span>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {list.length > 8 && (
        <button type="button" onClick={() => setAll((x) => !x)} className="mt-3 text-sm text-pp hover:text-pp-deep">
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </Card>
  );
}
