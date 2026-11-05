"use client";

/* eslint-disable @next/next/no-img-element -- product images come from many retailer CDNs */
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowUpRight, EyeOff, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Notice } from "@/components/ui/field";
import { api, type Id } from "@/lib/convex";
import { errorCode, errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Result = FunctionReturnType<typeof api.shopping.preview>;
type Offer = Result["results"][number];

const CHIP: Record<Offer["decision"], { label: string; className: string }> = {
  allowed: { label: "Agent can buy", className: "bg-pp/10 text-pp-deep" },
  needs_approval: { label: "Asks you first", className: "bg-black/[0.06] text-ink" },
  blocked: { label: "Hidden from agent", className: "bg-ink text-white" },
};

function OfferCard({ o }: { o: Offer }) {
  return (
    <li className={cn("flex gap-3 rounded-2xl border border-line p-3", o.decision === "blocked" && "opacity-70")}>
      <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-sunken">{o.image && <img src={o.image} alt="" loading="lazy" className="size-full object-contain" />}</div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm leading-snug text-ink">{o.title}</p>
        <p className="mt-1 text-xs text-muted">
          <span className="tabular text-ink">{o.price}</span> · {o.retailer}
          {o.brand ? ` · ${o.brand}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs", CHIP[o.decision].className)}>{CHIP[o.decision].label}</span>
          <a href={o.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-xs text-muted hover:text-ink">
            Retailer <ArrowUpRight className="size-3" />
          </a>
        </div>
        {o.decision !== "allowed" && <p className="mt-1.5 text-xs leading-relaxed text-muted">{o.reasons.join(" · ")}</p>}
      </div>
    </li>
  );
}

/**
 * The owner's view of policy-aware product search: what the agent gets back for a query,
 * and what Kept hides from it, with the reason. Searches are real (Channel3) and nothing is bought.
 */
export function ShopPreview({ mandateId, live }: { mandateId: Id<"mandates">; live: boolean }) {
  const preview = useAction(api.shopping.preview);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setPending(true);
    setError(null);
    try {
      setResult(await preview({ mandateId, query: query.trim(), limit: 10 }));
      setShowHidden(false);
    } catch (err) {
      setError({ code: errorCode(err), message: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  const hidden = result?.hidden.items ?? [];
  return (
    <Card>
      <CardHeader eyebrow="Agent shopping" title="What your agent can find" />
      <p className="-mt-2 mb-4 max-w-2xl text-sm text-muted">
        Your agent searches real products through Channel3. Kept turns this budget into the search itself, then checks every offer the way it checks a purchase. The agent only ever sees what it&apos;s allowed to buy.
      </p>
      <form onSubmit={onSearch} className="flex gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Try “A4 printer paper”" aria-label="Search products as your agent" maxLength={200} />
        <Button type="submit" loading={pending} icon={<Search className="size-4" />}>
          Search
        </Button>
      </form>
      {!live && <p className="mt-2 text-xs text-muted">The budget isn&apos;t active, so every offer would be hidden from the agent right now.</p>}
      {error && (
        <Notice tone={error.code === "CONFIG_MISSING" ? "neutral" : "bad"} className="mt-4">
          {error.code === "CONFIG_MISSING" ? "Product search isn't switched on for this deployment yet (it needs a Channel3 API key)." : error.message}
        </Notice>
      )}
      {result && (
        <div className="mt-5 space-y-4">
          <p className="text-xs text-muted">
            Searched with the budget applied: under <span className="text-ink">{result.searchedWith.maxPrice}</span>, in stock, {result.searchedWith.retailers === "any" ? "any retailer" : <span className="text-ink">{result.searchedWith.retailers.join(", ")}</span>}.
          </p>
          {result.results.length === 0 ? (
            <p className="text-sm text-muted">Nothing your agent could buy matched. {result.hidden.count ? `${result.hidden.count} offers were hidden.` : "Try a broader search."}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {result.results.map((o) => (
                <OfferCard key={o.url} o={o} />
              ))}
            </ul>
          )}
          {result.hidden.count > 0 && (
            <div className="rounded-2xl bg-sunken p-4">
              <button type="button" onClick={() => setShowHidden((x) => !x)} className="flex w-full items-center justify-between gap-3 text-left text-sm">
                <span className="inline-flex items-center gap-2 text-ink">
                  <EyeOff className="size-4 text-muted" /> {result.hidden.count} offer{result.hidden.count === 1 ? "" : "s"} hidden from your agent
                </span>
                <span className="text-xs text-muted">{showHidden ? "Hide" : "Show why"}</span>
              </button>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {Object.entries(result.hidden.reasons).map(([why, n]) => (
                  <li key={why}>
                    {n} × {why}
                  </li>
                ))}
              </ul>
              {showHidden && (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {hidden.map((o) => (
                    <OfferCard key={o.url} o={o} />
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="text-xs text-faint">{result.note}</p>
        </div>
      )}
    </Card>
  );
}
