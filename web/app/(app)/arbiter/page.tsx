"use client";

import { useMutation, useQuery } from "convex/react";
import { Gavel, RotateCcw, ShieldCheck, Snowflake } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Notice, Textarea } from "@/components/ui/field";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Countdown, RelativeTime } from "@/components/ui/time";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/type";
import { api, type Id } from "@/lib/convex";
import { errorMessage } from "@/lib/errors";
import { money } from "@/lib/format";

type Action =
  | { kind: "decide"; evidenceId: Id<"evidence">; outcome: "accepted" | "rejected" }
  | { kind: "resume"; contractId: Id<"contracts"> }
  | { kind: "resumeMandate"; mandateId: Id<"mandates"> }
  | { kind: "payout"; contractId: Id<"contracts"> };

export default function ArbiterPage() {
  const viewer = useQuery(api.users.viewer);
  const staff = viewer?.role === "arbiter" || viewer?.role === "admin";
  const q = useQuery(api.arbiter.queue, staff ? {} : "skip");
  const decide = useMutation(api.arbiter.decide);
  const resume = useMutation(api.arbiter.resume);
  const resumeMandate = useMutation(api.arbiter.resumeMandate);
  const retry = useMutation(api.arbiter.retryEffect);
  const setPayout = useMutation(api.arbiter.setPayoutEmail);
  const toast = useToast();
  const [action, setAction] = useState<Action | null>(null);
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);

  if (viewer === undefined) return <Skeleton className="h-64 rounded-card" />;
  if (!staff) {
    return <EmptyState icon={<ShieldCheck className="size-5" />} title="The arbiter desk is for arbiters" body="Neutral arbiters decide disputes and resume paused promises. An admin grants the role." />;
  }

  async function submit() {
    if (!action) return;
    setPending(true);
    try {
      if (action.kind === "decide") await decide({ evidenceId: action.evidenceId, outcome: action.outcome, reason: text.trim() });
      if (action.kind === "resume") await resume({ contractId: action.contractId, note: text.trim() });
      if (action.kind === "resumeMandate") await resumeMandate({ mandateId: action.mandateId, note: text.trim() });
      if (action.kind === "payout") await setPayout({ contractId: action.contractId, email: email.trim(), reason: text.trim() });
      toast({ title: "Done. It's on the signed record.", tone: "ok" });
      setAction(null);
      setText("");
      setEmail("");
    } catch (e) {
      toast({ title: "That didn't work", body: errorMessage(e), tone: "bad" });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader title="Arbiter desk" description="Every decision needs a reason, is signed into the journal, and both parties see it." />
      {q === undefined ? (
        <Skeleton className="h-64 rounded-card" />
      ) : (
        <>
          <div className="tabular mb-6 flex flex-wrap gap-2">
            <Chip tone={q.counts.evidence ? "warn" : "neutral"}>{q.counts.evidence} disputes</Chip>
            <Chip tone={q.counts.frozenContracts ? "bad" : "neutral"}>{q.counts.frozenContracts} frozen promises</Chip>
            <Chip tone={q.counts.frozenMandates ? "bad" : "neutral"}>{q.counts.frozenMandates} frozen budgets</Chip>
            <Chip tone={q.counts.failedEffects ? "bad" : "neutral"}>{q.counts.failedEffects} failed PayPal calls</Chip>
          </div>
          <div className="space-y-4">
            {q.evidence.map((ev) => (
              <Card key={ev._id}>
                <CardHeader
                  eyebrow={
                    <>
                      Dispute · <Link href={`/contracts/${ev.contractId}`} className="underline-offset-2 hover:underline">{ev.contractTitle || "promise"}</Link>
                    </>
                  }
                  title={ev.slotLabel}
                  action={ev.dueAt ? <Chip tone={ev.overdue ? "bad" : "warn"}>{ev.overdue ? "Overdue" : <>Due in <Countdown to={ev.dueAt} parts={2} /></>}</Chip> : null}
                />
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <p className="eyebrow mb-2">Agreed criteria</p>
                    <ul className="list-disc space-y-1 pl-4 text-sm text-ink-2">
                      {ev.criteria.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="eyebrow mb-2">The delivery</p>
                    {ev.fileUrl && (
                      <Button href={ev.fileUrl} external size="sm" variant="outline">
                        Open file
                      </Button>
                    )}
                    {ev.text && <p className="whitespace-pre-wrap text-sm text-ink-2">{ev.text}</p>}
                    {ev.url && <p className="break-all font-mono text-xs text-ink-2">{ev.url}</p>}
                    <p className="mt-2 text-xs text-muted">
                      Submitted <RelativeTime at={ev.submittedAt} />
                    </p>
                  </div>
                  <div className="space-y-2 text-sm">
                    <p className="eyebrow mb-2">What each side says</p>
                    {ev.ai && <p className="text-muted">AI: {(ev.ai as { summary?: string }).summary}</p>}
                    {ev.challenge && <p className="text-ink-2">Payer: &ldquo;{(ev.challenge as { reason?: string }).reason}&rdquo;</p>}
                    {ev.dispute && <p className="text-ink-2">Payee: &ldquo;{(ev.dispute as { reason?: string }).reason}&rdquo;</p>}
                  </div>
                </div>
                <div className="mt-5 flex gap-2 border-t border-line pt-4">
                  <Button size="sm" icon={<Gavel className="size-3.5" />} onClick={() => setAction({ kind: "decide", evidenceId: ev._id, outcome: "accepted" })}>
                    Accept delivery
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAction({ kind: "decide", evidenceId: ev._id, outcome: "rejected" })}>
                    Reject delivery
                  </Button>
                </div>
              </Card>
            ))}

            {q.frozenContracts.map((c) => (
              <Card key={c._id}>
                <CardHeader eyebrow={<span className="inline-flex items-center gap-1.5"><Snowflake className="size-3.5" /> Frozen promise</span>} title={<Link href={`/contracts/${c._id}`} className="hover:underline">{c.title}</Link>} />
                <Notice tone="bad">{c.reason}</Notice>
                <p className="tabular mt-3 text-xs text-muted">
                  held {money(c.ledger.heldCents)} · released {money(c.ledger.releasedCents)} · payout email {c.payoutEmail ?? "none"}
                </p>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => setAction({ kind: "resume", contractId: c._id })}>
                    Resume
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAction({ kind: "payout", contractId: c._id })}>
                    Fix payout email
                  </Button>
                </div>
              </Card>
            ))}

            {q.frozenMandates.map((m) => (
              <Card key={m._id}>
                <CardHeader eyebrow="Frozen agent budget" title={m.title} />
                <Notice tone="bad">{m.reason}</Notice>
                <Button size="sm" className="mt-4" onClick={() => setAction({ kind: "resumeMandate", mandateId: m._id })}>
                  Resume
                </Button>
              </Card>
            ))}

            {q.failedEffects.length > 0 && (
              <Card>
                <CardHeader eyebrow="Failed PayPal calls" title="Retry after fixing the cause" />
                <ul className="divide-y divide-line">
                  {q.failedEffects.map((e) => (
                    <li key={e._id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                      <div className="min-w-0">
                        <p>
                          <code className="font-mono text-xs">{e.kind}</code> · {e.streamKind} · {e.attempts} attempts
                        </p>
                        <p className="text-xs text-muted">{e.lastError}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={e.streamKind === "mandate" && e.kind === "capture_authorization"}
                        title={e.streamKind === "mandate" && e.kind === "capture_authorization" ? "Rolled back: the agent can request it again" : undefined}
                        onClick={async () => {
                          try {
                            await retry({ effectId: e._id });
                            toast({ title: "Retrying", tone: "ok" });
                          } catch (err) {
                            toast({ title: "Couldn't retry", body: errorMessage(err), tone: "bad" });
                          }
                        }}
                      >
                        Retry
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {q.counts.evidence + q.counts.frozenContracts + q.counts.frozenMandates + q.counts.failedEffects === 0 && <EmptyState icon={<ShieldCheck className="size-5" />} title="Nothing to decide" body="Disputes, paused promises and failed PayPal calls land here." />}
          </div>
        </>
      )}
      <Dialog
        open={action !== null}
        onClose={() => setAction(null)}
        title={action?.kind === "decide" ? (action.outcome === "accepted" ? "Accept this delivery?" : "Reject this delivery?") : action?.kind === "payout" ? "Change the payout email" : "Resume?"}
        description="Your reason is signed into the journal and shown to both parties."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)}>
              Back
            </Button>
            <Button loading={pending} disabled={text.trim().length < 5 || (action?.kind === "payout" && !email.includes("@"))} onClick={submit}>
              Confirm
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {action?.kind === "payout" && <Field label="New PayPal payout email">{(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>}
          <Field label={action?.kind === "decide" ? "Reason" : "Note"}>{(p) => <Textarea {...p} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />}</Field>
        </div>
      </Dialog>
    </>
  );
}
