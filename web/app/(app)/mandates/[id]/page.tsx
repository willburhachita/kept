"use client";

import { formatCents, type Currency } from "@kept/core";
import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowLeft, KeyRound, Plus } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { PayPalButton, PaymentAssurance } from "@/components/brand/paypal";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip, StatusChip } from "@/components/ui/chip";
import { CopyButton, SecretReveal } from "@/components/ui/copy";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Notice, Textarea } from "@/components/ui/field";
import { Skeleton, StackedBar } from "@/components/ui/misc";
import { Countdown, RelativeTime } from "@/components/ui/time";
import { useToast } from "@/components/ui/toast";
import { Stat } from "@/components/ui/type";
import { api, type Id, type MandateView } from "@/lib/convex";
import { errorMessage } from "@/lib/errors";
import { dateTime } from "@/lib/format";
import { mandateStatus, spendStatus } from "@/lib/status";

type View = MandateView;

function FundCard({ m }: { m: View }) {
  const start = useAction(api.mandates.fundStart);
  const confirm = useAction(api.mandates.fundConfirm);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [pending, setPending] = useState<null | "start" | "confirm">(null);
  const [note, setNote] = useState<string | null>(null);
  const once = useRef(false);
  const f = (n: number) => formatCents(n, m.policy.currency as Currency);

  async function doConfirm() {
    setPending("confirm");
    try {
      const r = await confirm({ mandateId: m._id });
      if ((r as { returned?: boolean }).returned) setNote("This checkout was closed, so PayPal's hold is being released back to you.");
      else if (r.status === "active") toast({ title: "Budget on hold. Your agent can spend now.", tone: "ok" });
    } catch (e) {
      setNote(errorMessage(e));
    } finally {
      setPending(null);
    }
  }
  useEffect(() => {
    const back = params.get("funding");
    if (!back) return;
    if (back === "approved" && m.status === "funding" && !once.current) {
      once.current = true;
      void doConfirm();
    }
    if (back === "cancelled") setNote("You left PayPal without approving. Nothing was charged.");
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  if (m.status !== "awaiting_funding" && m.status !== "funding") return null;
  return (
    <Card>
      <CardHeader eyebrow="Switch it on" title="Put the budget on hold with PayPal" />
      <p className="tabular text-[2.75rem] leading-none tracking-[-0.06em]">{f(m.authorizationCents)}</p>
      <p className="mt-2 text-sm text-muted">
        {f(m.policy.budgetCents)} budget + up to {f(m.maxFeeCents)} in fees. Only what your agent actually spends is captured; the rest is released when the budget closes.
      </p>
      {note && <Notice className="mt-4">{note}</Notice>}
      <div className="mt-6 max-w-sm space-y-3">
        {m.status === "awaiting_funding" && (
          <PayPalButton
            label="Hold with"
            loading={pending === "start"}
            onClick={async () => {
              setPending("start");
              try {
                const { approveUrl } = await start({ mandateId: m._id });
                window.location.assign(approveUrl);
              } catch (e) {
                toast({ title: "Couldn't start PayPal", body: errorMessage(e), tone: "bad" });
                setPending(null);
              }
            }}
          />
        )}
        {m.status === "funding" && (
          <>
            {m.funding?.approveUrl && <PayPalButton label="Continue to" onClick={() => window.location.assign(m.funding!.approveUrl!)} />}
            <Button variant="outline" className="w-full" loading={pending === "confirm"} onClick={doConfirm}>
              I approved on PayPal: confirm
            </Button>
          </>
        )}
        <PaymentAssurance />
      </div>
    </Card>
  );
}

function Tokens({ m }: { m: View }) {
  const issue = useAction(api.mandates.issueToken);
  const revoke = useMutation(api.mandates.revokeToken);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("my agent");
  const [hours, setHours] = useState("");
  const [pending, setPending] = useState(false);
  const [secret, setSecret] = useState<null | { token: string; mcpUrl: string; agentApiUrl: string }>(null);
  const closed = ["closing", "closed", "revoked"].includes(m.status);
  const command = secret ? `claude mcp add --transport http kept ${secret.mcpUrl} --header "Authorization: Bearer ${secret.token}"` : "";
  return (
    <Card>
      <CardHeader
        eyebrow="Agent tokens"
        title={`${m.tokens.filter((t) => t.active).length} active`}
        action={
          !closed && (
            <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setOpen(true)}>
              New token
            </Button>
          )
        }
      />
      {secret && (
        <div className="mb-5 space-y-3">
          <SecretReveal value={secret.token} title="Your agent's token" />
          <div className="rounded-2xl bg-sunken p-4">
            <p className="text-sm text-ink">Connect any MCP client</p>
            <div className="mt-2 flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all font-mono text-xs text-ink-2">{command}</code>
              <CopyButton value={command} />
            </div>
            <p className="mt-3 text-xs text-muted">
              Or call the REST API at <code className="font-mono">{secret.agentApiUrl}</code> with the same bearer token.
            </p>
          </div>
        </div>
      )}
      {m.tokens.length === 0 ? (
        <p className="text-sm text-muted">No tokens yet. A token lets one agent spend inside this budget, and nothing else.</p>
      ) : (
        <ul className="divide-y divide-line">
          {m.tokens.map((t) => (
            <li key={t._id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm">
                  <KeyRound className="size-3.5 text-muted" /> <code className="font-mono text-xs">{t.prefix}…</code> {t.label}
                </p>
                <p className="text-xs text-muted">
                  {t.lastUsedAt ? (
                    <>
                      last used <RelativeTime at={t.lastUsedAt} />
                    </>
                  ) : (
                    "never used"
                  )}{" "}
                  · expires {dateTime(t.expiresAt)}
                </p>
              </div>
              {t.active ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await revoke({ tokenId: t._id });
                      toast({ title: "Token revoked", body: "The agent can't spend with it any more.", tone: "ok" });
                    } catch (e) {
                      toast({ title: "Couldn't revoke", body: errorMessage(e), tone: "bad" });
                    }
                  }}
                >
                  Revoke
                </Button>
              ) : (
                <Chip tone="neutral">{t.revoked ? "Revoked" : "Expired"}</Chip>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New agent token"
        description="The token is shown once. Kept only stores its hash."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={pending}
              onClick={async () => {
                setPending(true);
                try {
                  const r = await issue({ mandateId: m._id, label, expiresInHours: hours ? Number(hours) : undefined });
                  setSecret({ token: r.token, mcpUrl: r.mcpUrl, agentApiUrl: r.agentApiUrl });
                  setOpen(false);
                } catch (e) {
                  toast({ title: "Couldn't issue a token", body: errorMessage(e), tone: "bad" });
                } finally {
                  setPending(false);
                }
              }}
            >
              Issue token
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Label">{(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />}</Field>
          <Field label="Expires after (hours)" optional hint="Defaults to the budget's own expiry.">
            {(p) => <Input {...p} inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />}
          </Field>
        </div>
      </Dialog>
    </Card>
  );
}

function Spends({ m }: { m: View }) {
  const rows = useQuery(api.mandates.spends, { mandateId: m._id });
  const decide = useMutation(api.mandates.decideSpend);
  const toast = useToast();
  const [declining, setDeclining] = useState<Id<"spends"> | null>(null);
  const [reason, setReason] = useState("");
  const act = async (spendId: Id<"spends">, approve: boolean, why?: string) => {
    try {
      const r = await decide({ spendId, approve, reason: why });
      toast({ title: approve ? (r.status === "executing" ? "Approved: paying the merchant" : "Declined: no longer within the budget") : "Declined", tone: approve && r.status === "executing" ? "ok" : "neutral" });
    } catch (e) {
      toast({ title: "Couldn't decide", body: errorMessage(e), tone: "bad" });
    }
  };
  return (
    <Card>
      <CardHeader eyebrow="Live feed" title="What your agent asked to buy" />
      {rows === undefined ? (
        <Skeleton className="h-24" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing yet. Requests appear here the moment your agent makes them.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((s) => (
            <li key={s._id} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px]">
                    <span className="tabular">{s.amount}</span> <span className="text-muted">· {s.merchantName}</span>
                  </p>
                  <p className="text-sm text-muted">{s.description}</p>
                  <p className="text-xs text-faint">
                    {s.merchantEmail} · <RelativeTime at={s.createdAt} />
                    {s.feeCents ? ` · fee ${formatCents(s.feeCents, m.policy.currency as Currency)}` : ""}
                  </p>
                </div>
                <StatusChip meta={spendStatus(s.status)} />
              </div>
              {s.reasons.length > 0 && <p className="mt-2 text-xs leading-relaxed text-muted">{s.reasons.join(" · ")}</p>}
              {s.canDecide && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => act(s._id, true)}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDeclining(s._id)}>
                    Decline
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={declining !== null}
        onClose={() => setDeclining(null)}
        title="Decline this purchase?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeclining(null)}>
              Back
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (declining) await act(declining, false, reason.trim() || undefined);
                setDeclining(null);
                setReason("");
              }}
            >
              Decline
            </Button>
          </>
        }
      >
        <Field label="Reason" optional hint="Your agent sees this.">
          {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}
        </Field>
      </Dialog>
    </Card>
  );
}

function Console() {
  const { id } = useParams<{ id: string }>();
  const m = useQuery(api.mandates.get, { mandateId: id as Id<"mandates"> });
  const revoke = useMutation(api.mandates.revoke);
  const toast = useToast();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  if (m === undefined) return <Skeleton className="h-96 rounded-card" />;
  const cur = m.policy.currency as Currency;
  const f = (n: number) => formatCents(n, cur);
  const live = m.status === "active";
  return (
    <>
      <Link href="/mandates" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Agent budgets
      </Link>
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap gap-2">
            <StatusChip meta={mandateStatus(m.status)} />
            {m.pendingApprovals > 0 && <Chip tone="warn">{m.pendingApprovals} waiting for you</Chip>}
          </div>
          <h1 className="mt-4 text-[clamp(1.875rem,3.4vw,2.75rem)] leading-[1.08] tracking-[-0.045em]">{m.policy.title}</h1>
          <p className="mt-2 max-w-2xl text-[15px] text-muted">{m.policy.purpose}</p>
        </div>
        {!["closing", "closed", "revoked"].includes(m.status) && (
          <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(true)}>
            {m.status === "active" ? "Close and release the rest" : "Revoke"}
          </Button>
        )}
      </header>
      {m.frozen && (
        <Notice tone="bad" className="mb-4" title="Paused">
          {m.frozen.reason}
        </Notice>
      )}
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <FundCard m={m} />
          <Card>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <Stat label="Left to spend" value={m.money.remaining} sub={`of ${m.money.budget}`} />
              {live && m.expiresAt && (
                <p className="text-sm text-muted">
                  Closes in <Countdown to={m.expiresAt} className="text-ink" parts={2} />
                </p>
              )}
            </div>
            <StackedBar
              className="mt-5"
              height="h-3"
              total={m.policy.budgetCents}
              segments={[
                { label: "Spent", value: m.spentCents, className: "bg-ink" },
                { label: "Waiting for approval or screening", value: m.reservedCents, className: "bg-pp" },
              ]}
            />
            <dl className="tabular mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              {[
                ["Spent", m.money.spent],
                ["Reserved", m.money.reserved],
                ["Fees", m.money.fees],
                ["Purchases left", `${m.purchasesLeft} of ${m.policy.maxPurchases}`],
              ].map(([l, v]) => (
                <div key={l}>
                  <dt className="text-xs text-muted">{l}</dt>
                  <dd className="mt-0.5">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Spends m={m} />
        </div>
        <aside className="space-y-4">
          <Card>
            <CardHeader eyebrow="Rules your agent is held to" />
            <ul className="space-y-2.5 text-sm leading-relaxed text-ink-2">
              {m.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="tabular mt-4 text-xs text-muted">
              {m.purchasesLastHour} of {m.policy.maxPerHour} this hour · hold {f(m.authorizationCents)}
            </p>
          </Card>
          <Tokens m={m} />
          {m.report && (
            <Card tone="sunken">
              <p className="text-sm text-ink">{m.report.ok ? "Caps proved" : "Some checks failed"}</p>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {m.report.properties.map((p) => (
                  <li key={p.id}>
                    {p.status === "proved" ? "✓" : "✗"} {p.title}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
      <Dialog
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        title={m.status === "active" ? "Close this budget?" : "Revoke this budget?"}
        description={m.status === "active" ? `Pending requests are cancelled and the unused hold (${m.money.remaining}) is released back to your PayPal. Tokens stop working.` : "It hasn't been funded, so nothing is charged."}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRevoke(false)}>
              Back
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await revoke({ mandateId: m._id });
                  toast({ title: "Closing the budget", tone: "ok" });
                } catch (e) {
                  toast({ title: "Couldn't close it", body: errorMessage(e), tone: "bad" });
                }
                setConfirmRevoke(false);
              }}
            >
              {m.status === "active" ? "Close budget" : "Revoke"}
            </Button>
          </>
        }
      />
    </>
  );
}

export default function MandatePage() {
  return (
    <Suspense>
      <Console />
    </Suspense>
  );
}
