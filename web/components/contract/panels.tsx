"use client";

import { formatCents, type Currency } from "@kept/core";
import { useAction, useMutation, useQuery } from "convex/react";
import { Check, Clock3, Link2, ShieldAlert, ShieldCheck } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PayPalButton, PaymentAssurance } from "@/components/brand/paypal";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { CopyButton, Hash } from "@/components/ui/copy";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Notice, Textarea } from "@/components/ui/field";
import { RelativeTime } from "@/components/ui/time";
import { useToast } from "@/components/ui/toast";
import { api, type ContractView } from "@/lib/convex";
import { errorMessage } from "@/lib/errors";
import { findRedFlags } from "@/lib/safety";
import { cn } from "@/lib/utils";

type View = NonNullable<ContractView>;

const cur = (c: View) => (c.ir?.currency ?? "USD") as Currency;

/** Who is who, with masked emails for the other side. */
export function PartiesCard({ c }: { c: View }) {
  const rows = [
    { role: "Payer", p: c.parties.funder, approved: c.approvals.funder, me: c.myRole === "funder" },
    { role: "Payee", p: c.parties.payee, approved: c.approvals.payee, me: c.myRole === "payee" },
  ];
  return (
    <Card>
      <CardHeader eyebrow="People" />
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.role} className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sunken text-sm uppercase text-muted">{r.p?.displayName.slice(0, 1) ?? "?"}</span>
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">
                  {r.p ? r.p.displayName : "Not joined yet"} {r.me && <span className="text-muted">(you)</span>}
                </p>
                <p className="truncate text-xs text-muted">
                  {r.role}
                  {r.p?.email ? ` · ${r.p.email}` : ""}
                  {r.role === "Payee" && r.p ? (r.p.hasPayoutEmail ? " · payout email set" : " · no payout email yet") : ""}
                </p>
              </div>
            </div>
            {c.termsHash && (r.approved ? <Chip tone="ok" icon={<Check className="size-3" />}>Approved</Chip> : <Chip tone="neutral">Not approved</Chip>)}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Creator: the invite link for the other side (shown once after creation, or re-issued). */
export function InviteCard({ c }: { c: View }) {
  const regen = useAction(api.contracts.regenerateInvite);
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    try {
      const k = `kept:invite:${c._id}`;
      const saved = sessionStorage.getItem(k);
      if (saved) setUrl(saved);
    } catch {
      /* storage unavailable */
    }
  }, [c._id]);
  if (!c.nextActions.includes("share_invite")) return null;
  return (
    <Card tone="dark">
      <p className="eyebrow text-white/50">Invite the other side</p>
      <p className="mt-2 text-lg leading-snug tracking-[-0.03em]">
        {c.invite?.email ? <>Send this link to {c.invite.email}.</> : "Send this link to the person you're dealing with."} <span className="text-white/45">It works once and expires in 14 days.</span>
      </p>
      {url ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-white/10 p-2 pl-3">
          <Link2 className="size-4 shrink-0 text-white/50" />
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{url}</code>
          <CopyButton value={url} dark />
        </div>
      ) : (
        <p className="mt-3 text-sm text-white/55">For safety the link is only shown once. Make a fresh one if you didn&apos;t copy it; the old link stops working.</p>
      )}
      <Button
        variant="inverse"
        size="sm"
        className="mt-4"
        loading={pending}
        onClick={async () => {
          setPending(true);
          try {
            const r = await regen({ contractId: c._id });
            setUrl(r.inviteUrl);
            try {
              sessionStorage.setItem(`kept:invite:${c._id}`, r.inviteUrl);
            } catch {
              /* ignore */
            }
            toast({ title: "New invite link ready", tone: "ok" });
          } catch (e) {
            toast({ title: "Couldn't make a link", body: errorMessage(e), tone: "bad" });
          } finally {
            setPending(false);
          }
        }}
      >
        {url ? "Make a new link" : "Make an invite link"}
      </Button>
    </Card>
  );
}

/** Scam red flags in the deal text, shown to whoever is about to approve or fund. */
export function SafetyPanel({ c }: { c: View }) {
  const flags = findRedFlags(c.prompt);
  return (
    <Card tone="sunken">
      <p className="flex items-center gap-2 text-sm font-medium">
        {flags.length ? <ShieldAlert className="size-4 text-bad" /> : <ShieldCheck className="size-4 text-ok" />}
        {flags.length ? `${flags.length} thing${flags.length > 1 ? "s" : ""} to check before you approve` : "No scam patterns in this deal"}
      </p>
      {flags.length > 0 ? (
        <ul className="mt-3 space-y-3">
          {flags.map((f) => (
            <li key={f.id} className="text-sm">
              <p className={cn(f.severity === "high" ? "text-bad" : "text-warn")}>
                {f.title} <span className="text-muted">(&ldquo;{f.match}&rdquo;)</span>
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{f.advice}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-muted">Still: never pay outside PayPal, never share passwords or codes, and compare the fingerprint below with the other side.</p>
      )}
    </Card>
  );
}

/** Review stage: approve exactly these terms (payees lock their payout email first). */
export function ApprovePanel({ c }: { c: View }) {
  const viewer = useQuery(api.users.viewer);
  const approve = useMutation(api.contracts.approve);
  const updateProfile = useMutation(api.users.updateProfile);
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const canApprove = c.nextActions.includes("approve");
  const needsPayout = c.myRole === "payee" && viewer && !viewer.payoutEmail;
  const both = c.approvals.funder && c.approvals.payee;

  async function onApprove() {
    if (!c.termsHash) return;
    setPending(true);
    try {
      if (needsPayout) await updateProfile({ payoutEmail: email.trim() });
      const r = await approve({ contractId: c._id, termsHash: c.termsHash });
      toast({ title: r.status === "awaiting_funding" ? "Both sides approved" : "You approved these terms", body: r.status === "awaiting_funding" ? "The payer can now put the money on hold." : "Waiting for the other side.", tone: "ok" });
    } catch (e) {
      toast({ title: "Couldn't approve", body: errorMessage(e), tone: "bad" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader eyebrow="Agreement" title={both ? "Both sides approved these terms" : canApprove ? "Approve exactly these terms" : "Waiting for the other side"} />
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-sunken p-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">Terms fingerprint</p>
          <p className="tabular mt-0.5 font-mono text-2xl tracking-[0.06em] text-ink">{c.termsHash ? `${c.termsHash.slice(0, 4)} ${c.termsHash.slice(4, 8)}` : "—"}</p>
        </div>
        <p className="max-w-xs text-xs leading-relaxed text-muted">Read these 8 characters to each other. If they match, you are both approving the very same proved terms.</p>
      </div>
      {c.termsHash ? <Hash value={c.termsHash} mode="full" className="mt-2 text-[11px]" /> : <p className="mt-2 text-xs text-muted">The fingerprint appears as soon as the other side joins: it covers both of you, so it can only exist once you both do.</p>}
      {canApprove && (
        <div className="mt-5 space-y-4">
          {needsPayout && (
            <Field label="Your PayPal email for payouts" hint="Locked when you approve. Only an arbiter can change it later, on the record, which stops payout-swap scams.">
              {(p) => <Input {...p} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@paypal-email.com" />}
            </Field>
          )}
          <Button size="lg" className="w-full sm:w-auto" loading={pending} disabled={Boolean(needsPayout) && !/^\S+@\S+\.\S+$/.test(email)} onClick={onApprove}>
            Approve terms {c.termsHash ? c.termsHash.slice(0, 4) : ""}
          </Button>
          <p className="text-xs leading-relaxed text-muted">Any change to the deal creates new terms with a new fingerprint, and both of you approve again.</p>
        </div>
      )}
    </Card>
  );
}

/** Funding: the hold number, the PayPal button, and the return trip from PayPal. */
export function FundPanel({ c }: { c: View }) {
  const start = useAction(api.funding.start);
  const confirm = useAction(api.funding.confirm);
  const reset = useAction(api.funding.reset);
  const toast = useToast();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, setPending] = useState<null | "start" | "confirm" | "reset">(null);
  const [note, setNote] = useState<null | { tone: "blue" | "warn" | "bad"; title: string; body: string }>(null);
  const confirmedOnce = useRef(false);
  const f = (n: number) => formatCents(n, cur(c));
  const back = params.get("funding");
  const isFunder = c.myRole === "funder";

  async function doConfirm() {
    setPending("confirm");
    try {
      const r = await confirm({ contractId: c._id });
      if (r.returned) setNote({ tone: "warn", title: "This checkout was closed", body: "PayPal took the payment after the checkout was closed, so Kept is returning it to you automatically." });
      else if (r.pending) setNote({ tone: "blue", title: "PayPal is still clearing your payment", body: "The promise starts automatically the moment PayPal confirms it. Nothing else to do." });
      else if (r.status === "active") toast({ title: "Money on hold. The promise is live.", tone: "ok" });
    } catch (e) {
      setNote({ tone: "bad", title: "Couldn't confirm the payment", body: errorMessage(e) });
    } finally {
      setPending(null);
    }
  }

  useEffect(() => {
    if (!back || !isFunder) return;
    if (back === "approved" && c.status === "funding" && !confirmedOnce.current) {
      confirmedOnce.current = true;
      void doConfirm();
    }
    if (back === "cancelled") setNote({ tone: "warn", title: "You left PayPal without approving", body: "Nothing was charged. Fund again whenever you're ready, or reset the checkout to change course." });
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [back]);

  if (!c.funding && !c.ir) return null;
  const hold = c.funding?.authorizationCents ?? null;
  const report = c.verification?.report as { lifecycle?: { steps: string[] } } | undefined;

  return (
    <Card>
      <CardHeader eyebrow={isFunder ? "Your move: fund it" : "Waiting for funding"} title={isFunder ? "Put the money on hold with PayPal" : `${c.parties.funder?.displayName ?? "The payer"} is putting the money on hold`} />
      <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
        <div>
          <p className="tabular text-[clamp(2.5rem,5vw,3.5rem)] leading-none tracking-[-0.06em]">{hold !== null ? f(hold) : c.money?.principal}</p>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {c.money?.principal} for the promise{c.funding ? ` + up to ${f(c.funding.maxFeeCents)} in fees, charged only as money is released` : ""}. {c.ir?.fundingMode === "authorize" ? "It stays on the payer's PayPal as a hold; nothing is taken until a rule releases it." : "It's paid into escrow on PayPal and held there."}
          </p>
        </div>
        {report?.lifecycle?.steps && (
          <ol className="space-y-2 text-sm text-ink-2">
            {report.lifecycle.steps.map((s, i) => (
              <li key={s} className="flex gap-3">
                <span className="tabular w-5 shrink-0 text-xs text-faint">{String(i + 1).padStart(2, "0")}</span>
                <span className="leading-relaxed">{s}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {note && (
        <Notice tone={note.tone} className="mt-6" title={note.title}>
          {note.body}
        </Notice>
      )}
      {isFunder ? (
        <div className="mt-6 max-w-sm space-y-3">
          {c.nextActions.includes("fund") && (
            <PayPalButton
              label="Hold with"
              loading={pending === "start"}
              onClick={async () => {
                setPending("start");
                try {
                  const { approveUrl } = await start({ contractId: c._id });
                  window.location.assign(approveUrl);
                } catch (e) {
                  toast({ title: "Couldn't start PayPal", body: errorMessage(e), tone: "bad" });
                  setPending(null);
                }
              }}
            />
          )}
          {c.status === "funding" && c.funding?.approveUrl && (
            <PayPalButton label="Continue to" onClick={() => window.location.assign(c.funding!.approveUrl!)} />
          )}
          {c.nextActions.includes("confirm_funding") && (
            <Button variant="outline" className="w-full" loading={pending === "confirm"} onClick={doConfirm}>
              I approved on PayPal: confirm
            </Button>
          )}
          {c.nextActions.includes("reset_funding") && (
            <button
              type="button"
              disabled={pending !== null}
              onClick={async () => {
                setPending("reset");
                try {
                  await reset({ contractId: c._id });
                  setNote(null);
                  toast({ title: "Checkout reset", body: "Fund again, or cancel the promise.", tone: "ok" });
                } catch (e) {
                  toast({ title: "Couldn't reset", body: errorMessage(e), tone: "bad" });
                } finally {
                  setPending(null);
                }
              }}
              className="w-full text-center text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
            >
              {pending === "reset" ? "Resetting…" : "Abandon this checkout"}
            </button>
          )}
          <PaymentAssurance />
        </div>
      ) : (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted">
          <Clock3 className="size-4" /> You&apos;ll get a notification the moment the money is on hold. Don&apos;t start work before that.
        </p>
      )}
    </Card>
  );
}

/** Draft / needs attention: edit the plain-English deal and prove it again. */
export function EditTermsPanel({ c }: { c: View }) {
  const update = useMutation(api.contracts.updatePrompt);
  const compile = useAction(api.compiler.compile);
  const toast = useToast();
  const [text, setText] = useState(c.prompt);
  const [pending, setPending] = useState(false);
  const flags = findRedFlags(text);
  if (!c.nextActions.includes("compile")) return null;
  return (
    <Card>
      <CardHeader eyebrow="The deal" title={c.status === "needs_attention" ? "Adjust the deal and prove it again" : "Describe the deal"} />
      <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} className="min-h-36 text-base" aria-label="Deal description" />
      {flags.length > 0 && <p className="mt-2 text-xs text-warn">Heads up: {flags.map((x) => x.title.toLowerCase()).join(", ")}.</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">Claude rewrites the promises and rules; the verifier checks them again. Approvals reset.</p>
        <Button
          loading={pending}
          disabled={!text.trim()}
          onClick={async () => {
            setPending(true);
            try {
              if (text.trim() !== c.prompt) await update({ contractId: c._id, prompt: text.trim() });
              compile({ contractId: c._id }).catch((e) => toast({ title: "Proving stopped", body: errorMessage(e), tone: "bad" }));
              toast({ title: "Writing and proving the rules", body: "Watch the proof timeline update live." });
            } catch (e) {
              toast({ title: "Couldn't start", body: errorMessage(e), tone: "bad" });
            } finally {
              setPending(false);
            }
          }}
        >
          Write &amp; prove the rules
        </Button>
      </div>
    </Card>
  );
}

/** Secondary actions from nextActions that live outside the stage panels. */
export function ActionBar({ c }: { c: View }) {
  const cancel = useMutation(api.contracts.cancel);
  const exit = useMutation(api.engine.consentExit);
  const toast = useToast();
  const [dialog, setDialog] = useState<null | "cancel" | "release_all" | "refund_all">(null);
  const [pending, setPending] = useState(false);
  const f = (n: number) => formatCents(n, cur(c));
  const items = [
    c.nextActions.includes("release_all") && { id: "release_all" as const, label: "Release everything", variant: "outline" as const },
    c.nextActions.includes("refund_all") && { id: "refund_all" as const, label: "Return everything", variant: "outline" as const },
    c.nextActions.includes("cancel") && { id: "cancel" as const, label: "Cancel", variant: "ghost" as const },
  ].filter(Boolean) as { id: "cancel" | "release_all" | "refund_all"; label: string; variant: "outline" | "ghost" }[];
  if (!items.length) return null;
  const copy = {
    cancel: { title: "Cancel this promise?", body: "Nothing has been charged. Both sides are notified and the promise closes for good.", cta: "Cancel promise" },
    release_all: { title: `Release ${f(c.ledger.heldCents)} now?`, body: "Everything still held goes to the payee immediately, whatever the deliveries. This can't be undone.", cta: "Release everything" },
    refund_all: { title: `Return ${f(c.ledger.heldCents)} to the payer?`, body: "Everything still held goes back to the payer. Use this if you can't deliver. This can't be undone.", cta: "Return everything" },
  };
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {items.map((i) => (
          <Button key={i.id} size="sm" variant={i.variant} onClick={() => setDialog(i.id)}>
            {i.label}
          </Button>
        ))}
      </div>
      {dialog && (
        <Dialog
          open
          onClose={() => setDialog(null)}
          title={copy[dialog].title}
          description={copy[dialog].body}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Back
              </Button>
              <Button
                variant={dialog === "cancel" ? "danger" : "primary"}
                loading={pending}
                onClick={async () => {
                  setPending(true);
                  try {
                    if (dialog === "cancel") await cancel({ contractId: c._id });
                    else await exit({ contractId: c._id, kind: dialog });
                    toast({ title: dialog === "cancel" ? "Promise cancelled" : "Done. PayPal is moving the money.", tone: "ok" });
                    setDialog(null);
                  } catch (e) {
                    toast({ title: "That didn't work", body: errorMessage(e), tone: "bad" });
                  } finally {
                    setPending(false);
                  }
                }}
              >
                {copy[dialog].cta}
              </Button>
            </>
          }
        />
      )}
    </>
  );
}

/** Settled: a certificate of what happened, to the cent. */
export function Certificate({ c }: { c: View }) {
  const f = (n: number) => formatCents(n, cur(c));
  return (
    <Card tone="dark" className="relative overflow-hidden">
      <p className="eyebrow text-white/45">Settlement certificate</p>
      <p className="mt-3 text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.08] tracking-[-0.045em]">
        Promise kept. <span className="text-white/40">Every cent went where the proved rules said.</span>
      </p>
      <dl className="tabular mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
        {[
          ["Paid to the payee", c.ledger.releasedCents],
          ["Returned to the payer", c.ledger.refundedCents],
          ["Kept fee", c.ledger.feesCents],
          ["Paid out by PayPal", c.ledger.paidOutCents],
        ].map(([l, v]) => (
          <div key={l as string}>
            <dt className="text-xs text-white/45">{l}</dt>
            <dd className="mt-1 text-2xl tracking-[-0.04em]">{f(v as number)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-8 text-xs text-white/45">
        Settled <RelativeTime at={c.settledAt} /> · terms {c.termsHash?.slice(0, 8)} · verify the signed receipts below or download the proof pack.
      </p>
    </Card>
  );
}
