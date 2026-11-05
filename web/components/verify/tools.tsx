"use client";

import { DEFAULT_FEE_BPS, EXAMPLES, verifyContract, type Currency, type VerifyInputResult } from "@kept/core";
import { useQuery } from "convex/react";
import { Check, FileUp, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useRef, useState } from "react";
import { ReportView } from "@/components/contract/report-view";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Hash } from "@/components/ui/copy";
import { Input, Notice, Select, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/convex";
import { errorMessage } from "@/lib/errors";
import { dateTime } from "@/lib/format";
import { fetchPublicKeys, verifyJournal, type JournalRow, type JournalVerification } from "@/lib/receipts";
import { inspectLink } from "@/lib/safety";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

/** Is this link really Kept? Checked locally. */
export function CheckLinkTool() {
  const [value, setValue] = useState("");
  const [r, setR] = useState<ReturnType<typeof inspectLink> | null>(null);
  return (
    <Card className="p-6 sm:p-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setR(inspectLink(value));
        }}
        className="flex flex-col gap-3 sm:flex-row"
      >
        <Input value={value} onChange={(e) => (setValue(e.target.value), setR(null))} placeholder="Paste the link someone sent you" aria-label="Link to check" className="h-12" />
        <Button type="submit" size="lg" disabled={!value.trim()}>
          Check
        </Button>
      </form>
      <p className="mt-3 text-xs text-muted">Checked in your browser. The link isn&apos;t sent anywhere, and nothing it points to is opened.</p>
      {r && (
        <div className={cn("mt-6 rounded-card p-6", r.ok ? "bg-ok-tint" : "bg-bad-tint")}>
          <p className={cn("flex items-center gap-2 text-xl font-semibold tracking-[-0.04em]", r.ok ? "text-ok" : "text-bad")}>
            {r.ok ? <ShieldCheck className="size-5" /> : <ShieldAlert className="size-5" />}
            {r.ok ? "This is a genuine Kept link" : "Don't trust this link"}
          </p>
          {r.ok ? (
            <p className="mt-2 text-sm text-ink-2">
              It points to {r.host}
              {r.kind !== "other" ? `, and it's ${r.kind === "invite" ? "an invite" : `a ${r.kind}`} link` : ""}. Even so: Kept never asks for your PayPal password, a fee to receive money, or payment outside PayPal.
            </p>
          ) : (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-2">
              {r.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

interface Pack {
  format?: string;
  contractId?: string;
  ir?: unknown;
  feeBps?: number;
  verification?: { ok: boolean; summary: string } | null;
  journal?: (JournalRow & { stream?: string })[];
}

/** Drop a proof pack: re-check every hash and signature, and re-run the proof. */
export function VerifyReceiptsTool() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<null | { stream: string; rows: JournalRow[]; chain: JournalVerification; rerun: VerifyInputResult | null; claimed: boolean | null }>(null);

  async function run(raw: string) {
    setBusy(true);
    setError(null);
    setOut(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("That isn't valid JSON. Paste the proof pack exactly as downloaded.");
      }
      const pack: Pack = Array.isArray(parsed) ? { journal: parsed as Pack["journal"] } : (parsed as Pack);
      const rows = pack.journal ?? [];
      if (!rows.length) throw new Error("No journal entries found. A proof pack has a \"journal\" array.");
      const stream = pack.contractId ?? rows[0]?.stream;
      if (!stream) throw new Error("The entries don't say which contract they belong to.");
      const keys = await fetchPublicKeys();
      const chain = verifyJournal(stream, rows, keys);
      const rerun = pack.ir ? verifyContract(pack.ir, { feeBps: pack.feeBps ?? DEFAULT_FEE_BPS }) : null;
      setOut({ stream, rows, chain, rerun, claimed: pack.verification?.ok ?? null });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-6 sm:p-8">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder='{ "format": "kept-proof-pack/v1", ... }' aria-label="Proof pack JSON" className="min-h-40 font-mono text-xs" />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button loading={busy} disabled={!text.trim()} onClick={() => run(text)}>
            Verify
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const t = await f.text();
              setText(t);
              void run(t);
            }}
          />
          <Button variant="secondary" icon={<FileUp className="size-4" />} onClick={() => fileRef.current?.click()}>
            Open a file
          </Button>
          <p className="text-xs text-muted">
            Keys from <a href={site.keysUrl} target="_blank" rel="noopener noreferrer" className="underline">{site.keysUrl.replace(/^https:\/\//, "")}</a>
          </p>
        </div>
      </Card>
      {error && <Notice tone="bad">{error}</Notice>}
      {out && (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <Card tone={out.chain.ok ? "dark" : "light"}>
            <p className={cn("flex items-center gap-2 text-2xl font-semibold tracking-[-0.045em]", !out.chain.ok && "text-bad")}>
              {out.chain.ok ? <ShieldCheck className="size-6 text-pp-sky" /> : <ShieldAlert className="size-6" />}
              {out.chain.ok ? `${out.chain.checked} receipts verified` : `Broken at entry ${out.chain.failedAt}`}
            </p>
            <p className={cn("mt-2 text-sm leading-relaxed", out.chain.ok ? "text-white/60" : "text-muted")}>
              {out.chain.ok ? "Every hash recomputed, every link followed from the first entry, every Ed25519 signature checked against the published key." : out.chain.reason}
            </p>
            {out.rerun && (
              <div className={cn("mt-6 rounded-2xl p-4 text-sm", out.chain.ok ? "bg-white/[0.07]" : "bg-sunken")}>
                <p className="font-medium">Proof re-run in your browser</p>
                <p className={cn("mt-1", out.chain.ok ? "text-white/60" : "text-muted")}>
                  {out.rerun.valid ? out.rerun.report.summary : "The terms in the pack don't validate."}
                  {out.claimed !== null && out.rerun.valid && (out.rerun.report.ok === out.claimed ? " Matches what the pack claims." : " Does NOT match what the pack claims.")}
                </p>
              </div>
            )}
            <p className={cn("mt-6 text-xs", out.chain.ok ? "text-white/40" : "text-faint")}>
              Contract <Hash value={out.stream} chars={14} dark={out.chain.ok} />
            </p>
          </Card>
          <Card>
            <ol className="max-h-[28rem] space-y-1 overflow-y-auto pr-1">
              {out.rows.map((r) => {
                const ok = out.chain.perEntry[r.seq];
                return (
                  <li key={r.seq} className="flex items-start gap-3 py-1.5 text-sm">
                    <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-white", ok === true ? "bg-ok" : ok === false ? "bg-bad" : "bg-line-2")}>
                      {ok === false ? <X className="size-3" /> : <Check className="size-3" />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-ink">
                        #{r.seq} {r.type}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {r.actor} · {dateTime(r.at)} · <span className="font-mono">{r.hash.slice(0, 16)}…</span>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      )}
      <LookupEntry />
    </div>
  );
}

/** Is one entry in the public transparency log? */
function LookupEntry() {
  const [hash, setHash] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const res = useQuery(api.transparency.verifyEntry, query ? { entryHash: query } : "skip");
  return (
    <Card tone="sunken" className="p-6">
      <p className="text-lg font-semibold tracking-[-0.035em]">Look up one receipt in the public log</p>
      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(hash.trim().toLowerCase());
        }}
      >
        <Input value={hash} onChange={(e) => setHash(e.target.value)} placeholder="64-character entry hash" aria-label="Entry hash" className="font-mono text-xs" />
        <Button type="submit" variant="secondary" disabled={!/^[0-9a-fA-F]{64}$/.test(hash.trim())}>
          Look up
        </Button>
      </form>
      {query && res === undefined && <Spinner className="mt-4" />}
      {query && res === null && <Notice tone="bad" className="mt-4">No receipt with that hash exists in the log.</Notice>}
      {res && (
        <Notice tone={res.status === "sealed" && "verified" in res && res.verified.inclusion && res.verified.checkpointSignature ? "ok" : "blue"} className="mt-4" title={`#${res.entry.seq} ${res.entry.type}`}>
          {res.status === "pending"
            ? "Found. It will be sealed into the next signed checkpoint within about 10 minutes."
            : "verified" in res
              ? `Sealed in checkpoint #${res.checkpoint.seq} (${res.treeSize} entries). Inclusion proof ${res.verified.inclusion ? "valid" : "INVALID"}, checkpoint signature ${res.verified.checkpointSignature ? "valid" : "INVALID"}.`
              : null}
        </Notice>
      )}
    </Card>
  );
}

const EXAMPLE_NAMES: Record<keyof typeof EXAMPLES, string> = {
  logoNaive: "Logo deal (first draft, has a bug)",
  logoFixed: "Logo deal (repaired)",
  plumberDraft: "Plumber visit (first draft)",
  plumberVisit: "Plumber visit (repaired)",
};

/** Paste or pick contract terms and prove them right here. */
export function ProveTool() {
  const [pick, setPick] = useState<keyof typeof EXAMPLES>("logoNaive");
  const [text, setText] = useState(() => JSON.stringify(EXAMPLES.logoNaive, null, 2));
  const [res, setRes] = useState<VerifyInputResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  function run() {
    setBusy(true);
    setParseError(null);
    setTimeout(() => {
      try {
        setRes(verifyContract(JSON.parse(text), { feeBps: DEFAULT_FEE_BPS }));
      } catch {
        setRes(null);
        setParseError("That isn't valid JSON.");
      }
      setBusy(false);
    }, 30);
  }
  return (
    <div className="space-y-4">
      <Card className="p-6 sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select
            value={pick}
            onChange={(e) => {
              const k = e.target.value as keyof typeof EXAMPLES;
              setPick(k);
              setText(JSON.stringify(EXAMPLES[k], null, 2));
              setRes(null);
            }}
            aria-label="Example contract"
            className="sm:max-w-xs"
          >
            {Object.entries(EXAMPLE_NAMES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted">Or paste your own terms. See the contract language in the docs.</p>
        </div>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Contract terms JSON" className="mt-4 min-h-64 font-mono text-xs leading-relaxed" spellCheck={false} />
        <Button className="mt-4" loading={busy} onClick={run}>
          Prove it
        </Button>
      </Card>
      {parseError && <Notice tone="bad">{parseError}</Notice>}
      {res && !res.valid && (
        <Notice tone="bad" title="These terms don't validate">
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {res.issues.slice(0, 12).map((i) => (
              <li key={`${i.path}${i.message}`}>
                <code className="font-mono text-xs">{i.path}</code>: {i.message}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {res?.valid && (
        <Card className="p-6 sm:p-8">
          <ReportView report={res.report} currency={res.ir.currency as Currency} principalCents={res.ir.principalCents} />
        </Card>
      )}
    </div>
  );
}
