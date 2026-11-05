"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AlertTriangle, ExternalLink, FileUp, Gavel, Link2, ShieldCheck, Type } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/chip";
import { Hash } from "@/components/ui/copy";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Notice, Textarea } from "@/components/ui/field";
import { Meter, Skeleton } from "@/components/ui/misc";
import { Countdown, CountdownRing, RelativeTime } from "@/components/ui/time";
import { useToast } from "@/components/ui/toast";
import { api, type ContractView, type Id } from "@/lib/convex";
import { errorMessage } from "@/lib/errors";
import { pct } from "@/lib/format";
import { evidenceStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

type View = NonNullable<ContractView>;
type Item = FunctionReturnType<typeof api.evidence.list>[number];

interface Verdict {
  criteria: { criterion: string; met: boolean; confidence: number; reason: string }[];
  overall: "pass" | "fail" | "uncertain";
  confidence: number;
  summary: string;
  suspectedManipulation: boolean;
  manipulationNotes: string;
}

const TIMER_LABEL: Record<string, string> = {
  ai_check: "AI check due in",
  challenge_window: "Payer can object for",
  funder_review: "Payer must decide within",
  dispute_window: "Payee can dispute for",
  arbitration: "Arbiter decides within",
};

/** Who made a final decision, from its journal actor (only the payer decides as a user). */
function decidedBy(by?: string): string {
  if (by?.startsWith("arbiter:")) return "The arbiter";
  if (by?.startsWith("user:")) return "The payer";
  return "Kept's rules";
}

/** Payee: deliver one deliverable (file upload, text or link). */
function SubmitSlot({ c, slotId }: { c: View; slotId: string }) {
  const slot = c.ir?.evidence.find((e) => e.id === slotId);
  const genUrl = useMutation(api.evidence.generateUploadUrl);
  const submit = useMutation(api.evidence.submit);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [text, setText] = useState("");
  if (!slot) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      if (slot!.kind === "file") {
        const file = fileRef.current?.files?.[0];
        if (!file) throw new Error("Choose a file first.");
        const { uploadUrl, maxBytes, allowedTypes } = await genUrl({ contractId: c._id });
        if (file.size > maxBytes) throw new Error(`The file is over ${Math.round(maxBytes / 1024 / 1024)} MB.`);
        if (!allowedTypes.includes(file.type)) throw new Error(`Files of type ${file.type || "unknown"} aren't accepted. Use an image, PDF or text file.`);
        const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
        if (!res.ok) throw new Error("Upload failed. Try again.");
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await submit({ contractId: c._id, slotId, storageId, fileName: file.name });
      } else if (slot!.kind === "link") {
        await submit({ contractId: c._id, slotId, url: text.trim() });
      } else {
        await submit({ contractId: c._id, slotId, text: text.trim() });
      }
      toast({ title: "Delivered", body: `${slot!.label} is with the reviewer now.`, tone: "ok" });
      setText("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      toast({ title: "Couldn't submit", body: errorMessage(err), tone: "bad" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-dashed border-line-2 p-5">
      <p className="flex items-center gap-2 text-[15px] text-ink">
        {slot.kind === "file" ? <FileUp className="size-4" /> : slot.kind === "link" ? <Link2 className="size-4" /> : <Type className="size-4" />}
        Deliver: {slot.label}
      </p>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted">
        {slot.criteria.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <div className="mt-4">
        {slot.kind === "file" ? (
          <input ref={fileRef} type="file" required accept="image/*,application/pdf,text/plain,text/markdown,image/svg+xml" className="block w-full text-sm text-muted file:mr-4 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:text-sm file:text-white hover:file:bg-ink-2" />
        ) : slot.kind === "link" ? (
          <Input type="url" required placeholder="https://" value={text} onChange={(e) => setText(e.target.value)} />
        ) : (
          <Textarea required maxLength={5000} placeholder="Describe what you delivered" value={text} onChange={(e) => setText(e.target.value)} />
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-faint">Files are fingerprinted (SHA-256) and checked by the AI examiner against the criteria above.</p>
        <Button type="submit" loading={pending}>
          Submit delivery
        </Button>
      </div>
    </form>
  );
}

function ReasonDialog({ open, onClose, title, description, confirm, tone, onConfirm }: { open: boolean; onClose: () => void; title: string; description: string; confirm: string; tone?: "danger"; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Back
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            loading={pending}
            disabled={reason.trim().length < 5}
            onClick={async () => {
              setPending(true);
              try {
                await onConfirm(reason.trim());
                setReason("");
                onClose();
              } finally {
                setPending(false);
              }
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <Field label="Reason" hint="Both sides and the arbiter see this. Be specific: which criterion isn't met, and why.">
        {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />}
      </Field>
    </Dialog>
  );
}

function EvidenceTile({ ev }: { ev: Item }) {
  const accept = useMutation(api.evidence.accept);
  const reject = useMutation(api.evidence.reject);
  const challenge = useMutation(api.evidence.challenge);
  const dispute = useMutation(api.evidence.dispute);
  const toast = useToast();
  const [dialog, setDialog] = useState<null | "reject" | "challenge" | "dispute">(null);
  const [accepting, setAccepting] = useState(false);
  const meta = evidenceStatus(ev.status);
  const ai = ev.ai as Verdict | null;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast({ title: ok, tone: "ok" });
    } catch (e) {
      toast({ title: "That didn't work", body: errorMessage(e), tone: "bad" });
      throw e;
    }
  };
  const timerStart = ev.timer?.kind === "challenge_window" ? ev.submittedAt : ev.submittedAt;
  return (
    <article className="rounded-2xl border border-line p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] text-ink">{ev.slotLabel}</p>
          <p className="mt-0.5 text-xs text-muted">
            Submitted <RelativeTime at={ev.submittedAt} /> · {ev.onTime ? "on time" : "after the deadline"}
          </p>
        </div>
        <StatusChip meta={meta} />
      </div>

      {ev.file && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-sunken p-3">
          {ev.file.contentType?.startsWith("image/") && ev.file.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ev.file.url} alt={ev.file.fileName ?? "Submitted file"} className="size-16 rounded-lg bg-white object-contain" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{ev.file.fileName ?? "file"}</p>
            <p className="text-xs text-muted">
              {ev.file.contentType} {ev.file.size ? `· ${(ev.file.size / 1024).toFixed(1)} KB` : ""}
            </p>
            {ev.file.sha256 && <Hash value={ev.file.sha256} chars={16} className="text-xs" />}
          </div>
          {ev.file.url && (
            <Button href={ev.file.url} external variant="outline" size="sm" iconRight={<ExternalLink className="size-3.5" />}>
              Open
            </Button>
          )}
        </div>
      )}
      {ev.text && <p className="mt-4 whitespace-pre-wrap rounded-xl bg-sunken p-3 text-sm text-ink-2">{ev.text}</p>}
      {ev.url && (
        <p className="mt-4 text-sm">
          Link: <span className="break-all font-mono text-xs text-ink-2">{ev.url}</span>
          <span className="block text-xs text-faint">Check the address before opening a link someone sent you.</span>
        </p>
      )}

      {ai && (
        <div className="mt-4 rounded-xl bg-pp-tint/60 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-pp-deep">
            <ShieldCheck className="size-4" /> AI examiner: {ai.overall} ({pct(ai.confidence)} confident)
          </p>
          <p className="mt-1 text-sm text-ink-2">{ai.summary}</p>
          <ul className="mt-3 space-y-2.5">
            {ai.criteria.map((cr) => (
              <li key={cr.criterion}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className={cn(cr.met ? "text-ink" : "text-bad")}>
                    {cr.met ? "✓" : "✗"} {cr.criterion}
                  </span>
                  <span className="tabular text-xs text-muted">{pct(cr.confidence)}</span>
                </div>
                <Meter value={cr.confidence} className="mt-1" barClassName={cr.met ? "bg-ok" : "bg-bad"} />
                <p className="mt-1 text-xs text-muted">{cr.reason}</p>
              </li>
            ))}
          </ul>
          {ai.suspectedManipulation && (
            <Notice tone="bad" className="mt-3" icon={<AlertTriangle className="size-4" />} title="Possible manipulation">
              {ai.manipulationNotes || "The file may contain instructions aimed at the AI. A human should review it."}
            </Notice>
          )}
        </div>
      )}
      {ev.aiError && !ai && <Notice className="mt-4">The AI check didn&apos;t finish ({ev.aiError}). The payer reviews it directly.</Notice>}

      {(ev.challenge || ev.dispute || ev.decision) && (
        <div className="mt-4 space-y-2 text-sm">
          {ev.challenge && <p className="text-muted">Payer objected: &ldquo;{(ev.challenge as { reason?: string }).reason}&rdquo;</p>}
          {ev.dispute && <p className="text-muted">Payee disputed: &ldquo;{(ev.dispute as { reason?: string }).reason}&rdquo;</p>}
          {ev.decision && (
            <p className="flex items-center gap-2 text-ink">
              <Gavel className="size-4" /> {decidedBy((ev.decision as { by?: string }).by)} {(ev.decision as { outcome?: string }).outcome} it · &ldquo;{(ev.decision as { reason?: string }).reason}&rdquo;
            </p>
          )}
        </div>
      )}

      {ev.timer?.endsAt && (
        <div className="mt-4 flex items-center gap-3 text-sm text-muted">
          <CountdownRing startedAt={timerStart} endsAt={ev.timer.endsAt} size={32} className="text-ink" />
          <span>
            {TIMER_LABEL[ev.timer.kind] ?? "Time left"} <Countdown to={ev.timer.endsAt} className="text-ink" />
          </span>
        </div>
      )}

      {(ev.canAccept || ev.canReject || ev.canChallenge || ev.canDispute) && (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          {ev.canAccept && (
            <Button
              loading={accepting}
              onClick={async () => {
                setAccepting(true);
                await run(() => accept({ evidenceId: ev._id }), "Accepted. The rules release the money now.").catch(() => {});
                setAccepting(false);
              }}
            >
              Accept and release
            </Button>
          )}
          {ev.canChallenge && (
            <Button variant="outline" onClick={() => setDialog("challenge")}>
              Object
            </Button>
          )}
          {ev.canReject && (
            <Button variant="outline" onClick={() => setDialog("reject")}>
              Reject
            </Button>
          )}
          {ev.canDispute && (
            <Button variant="outline" onClick={() => setDialog("dispute")}>
              Dispute the rejection
            </Button>
          )}
        </div>
      )}
      <ReasonDialog
        open={dialog === "reject"}
        onClose={() => setDialog(null)}
        title="Reject this delivery?"
        description="The payee gets a window to dispute. If they do, a neutral arbiter decides."
        confirm="Reject"
        tone="danger"
        onConfirm={(reason) => run(() => reject({ evidenceId: ev._id, reason }), "Rejected")}
      />
      <ReasonDialog
        open={dialog === "challenge"}
        onClose={() => setDialog(null)}
        title="Object to the AI's pass?"
        description="The delivery goes to a human arbiter instead of counting as accepted when the window closes."
        confirm="Send to arbiter"
        onConfirm={(reason) => run(() => challenge({ evidenceId: ev._id, reason }), "Sent to the arbiter")}
      />
      <ReasonDialog
        open={dialog === "dispute"}
        onClose={() => setDialog(null)}
        title="Dispute the rejection?"
        description="A neutral arbiter compares the delivery against the agreed criteria and decides."
        confirm="Send to arbiter"
        onConfirm={(reason) => run(() => dispute({ evidenceId: ev._id, reason }), "Sent to the arbiter")}
      />
    </article>
  );
}

export function EvidencePanel({ c }: { c: View }) {
  const items = useQuery(api.evidence.list, { contractId: c._id });
  const slots = c.nextActions.filter((a) => a.startsWith("submit_evidence:")).map((a) => a.slice("submit_evidence:".length));
  const total = c.ir?.evidence.length ?? 0;
  return (
    <Card>
      <CardHeader eyebrow="Deliveries" title={total ? `${items?.length ?? 0} of ${total} delivered` : "Deliveries"} />
      <div className="space-y-3">
        {slots.map((s) => (
          <SubmitSlot key={s} c={c} slotId={s} />
        ))}
        {items === undefined && <Skeleton className="h-28" />}
        {items?.map((ev) => (
          <EvidenceTile key={ev._id} ev={ev} />
        ))}
        {items?.length === 0 && slots.length === 0 && (
          <p className="text-sm text-muted">{c.myRole === "payee" ? "Nothing to deliver right now." : "Nothing delivered yet. You'll get a notification the moment something arrives."}</p>
        )}
      </div>
    </Card>
  );
}
