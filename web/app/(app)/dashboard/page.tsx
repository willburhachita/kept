"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowRight, Bot, FileSignature, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ContractRow } from "@/components/contract/contract-row";
import { streamHref } from "@/components/site/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/chip";
import { Field, Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import { Photo } from "@/components/ui/photo";
import { RelativeTime } from "@/components/ui/time";
import { useToast } from "@/components/ui/toast";
import { SectionLabel, Stat } from "@/components/ui/type";
import { api } from "@/lib/convex";
import { errorMessage } from "@/lib/errors";
import { money } from "@/lib/format";
import { PHOTOS } from "@/lib/site";
import { mandateStatus } from "@/lib/status";

const NEEDS_YOU: Record<string, (role: string | null) => string | null> = {
  review: () => "Review and approve the proved terms",
  needs_attention: () => "The rules need another pass",
  awaiting_funding: (r) => (r === "funder" ? "Put the money on hold with PayPal" : null),
  funding: (r) => (r === "funder" ? "Finish the PayPal approval" : null),
  frozen: () => "Paused: an arbiter is reviewing",
};

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function PayoutNudge() {
  const update = useMutation(api.users.updateProfile);
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <Card tone="sunken" className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <div className="flex-1">
        <p className="text-[15px] text-ink">Where should your money go?</p>
        <p className="mt-1 text-sm text-muted">Add the PayPal email you get paid at. It locks when you approve a promise, so nobody can redirect your payout.</p>
      </div>
      <form
        className="flex w-full gap-2 sm:w-auto"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          try {
            await update({ payoutEmail: email.trim() });
            toast({ title: "Payout email saved", tone: "ok" });
          } catch (err) {
            toast({ title: "Couldn't save", body: errorMessage(err), tone: "bad" });
          } finally {
            setPending(false);
          }
        }}
      >
        <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@paypal-email.com" aria-label="PayPal payout email" className="sm:w-64" />
        <Button type="submit" loading={pending}>
          Save
        </Button>
      </form>
    </Card>
  );
}

export default function DashboardPage() {
  const viewer = useQuery(api.users.viewer);
  const contracts = useQuery(api.contracts.listMine);
  const mandates = useQuery(api.mandates.listMine);
  const notes = useQuery(api.notifications.list, { limit: 6 });

  const todo = (contracts ?? [])
    .map((c) => ({ c, why: NEEDS_YOU[c.status]?.(c.myRole) ?? (c.status === "active" ? null : null) }))
    .filter((x) => x.why);
  const sum = (k: "heldCents" | "releasedCents") => (contracts ?? []).filter((c) => (c.currency ?? "USD") === "USD").reduce((s, c) => s + c[k], 0);
  const live = (contracts ?? []).filter((c) => c.status === "active").length;
  const firstTime = contracts !== undefined && contracts.length === 0 && (mandates?.length ?? 0) === 0;

  return (
    <>
      <header className="mb-10">
        <SectionLabel index="00">Overview</SectionLabel>
        <h1 className="mt-4 text-[clamp(2rem,4vw,3rem)] leading-[1.05] tracking-[-0.05em]">
          {greeting()}, {viewer?.displayName?.split(" ")[0] ?? "there"}.{" "}
          <span className="text-faint">{todo.length ? `${todo.length} thing${todo.length > 1 ? "s" : ""} need${todo.length > 1 ? "" : "s"} you.` : "Nothing needs you right now."}</span>
        </h1>
      </header>

      {viewer && !viewer.payoutEmail && (
        <div className="mb-4">
          <PayoutNudge />
        </div>
      )}

      {firstTime ? (
        <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
          <div className="relative min-h-[22rem] overflow-hidden rounded-card bg-ink text-white">
            <Photo src={PHOTOS.womanFolder} sizes="(min-width: 1024px) 55vw, 100vw" className="opacity-85" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
            <div className="absolute inset-x-6 bottom-6 sm:inset-x-8 sm:bottom-8">
              <p className="max-w-md text-[1.75rem] leading-[1.15] tracking-[-0.04em]">
                Your first promise takes a sentence. <span className="text-white/50">Kept handles the rest.</span>
              </p>
              <Button href="/new" variant="inverse" size="lg" className="mt-6" iconRight={<ArrowRight className="size-4" />}>
                Make a promise
              </Button>
            </div>
          </div>
          <div className="grid gap-3">
            <Card>
              <FileSignature className="size-5" />
              <p className="mt-4 text-lg tracking-[-0.03em]">Pay or get paid, safely</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">Freelance work, home repairs, supplier orders. The money waits on PayPal until the promise is kept.</p>
            </Card>
            <Card>
              <Bot className="size-5" />
              <p className="mt-4 text-lg tracking-[-0.03em]">Give an agent a budget</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">Let an AI agent buy within rules you can read, and approve anything above your limit.</p>
              <Button href="/mandates/new" variant="secondary" size="sm" className="mt-4">
                Set up an agent budget
              </Button>
            </Card>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Card>
              <Stat label="Held for your promises" value={contracts ? money(sum("heldCents")) : "…"} sub="On PayPal holds, released only by the rules" />
            </Card>
            <Card>
              <Stat label="Released so far" value={contracts ? money(sum("releasedCents")) : "…"} sub="Across every promise you're part of" />
            </Card>
            <Card tone="dark">
              <Stat dark label="Live promises" value={contracts ? live : "…"} sub={`${contracts?.length ?? 0} in total`} />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <div className="space-y-4">
              {todo.length > 0 && (
                <Card>
                  <CardHeader eyebrow="Needs you" title="Waiting on your move" />
                  <ul className="divide-y divide-line">
                    {todo.map(({ c, why }) => (
                      <li key={c._id}>
                        <Link href={`/contracts/${c._id}`} className="group flex items-center justify-between gap-4 py-3.5">
                          <div className="min-w-0">
                            <p className="truncate text-[15px] text-ink">{c.title}</p>
                            <p className="text-sm text-muted">{why}</p>
                          </div>
                          <ArrowRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              <div className="flex items-center justify-between">
                <p className="eyebrow">Recent promises</p>
                <Button href="/contracts" variant="link" size="sm">
                  See all
                </Button>
              </div>
              {contracts === undefined ? (
                <Skeleton className="h-28 rounded-card" />
              ) : (
                <div className="space-y-3">
                  {contracts.slice(0, 4).map((c) => (
                    <ContractRow key={c._id} c={c} />
                  ))}
                </div>
              )}
            </div>

            <aside className="space-y-4">
              <Card>
                <CardHeader
                  eyebrow="Agent budgets"
                  action={
                    <Button href="/mandates/new" size="sm" variant="secondary" icon={<Plus className="size-3.5" />}>
                      New
                    </Button>
                  }
                />
                {mandates === undefined ? (
                  <Skeleton className="h-16" />
                ) : mandates.length === 0 ? (
                  <p className="text-sm text-muted">No agent budgets yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {mandates.slice(0, 4).map((m) => (
                      <li key={m._id}>
                        <Link href={`/mandates/${m._id}`} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm text-ink">{m.title}</p>
                            <p className="tabular text-xs text-muted">
                              {money(m.remainingCents, m.currency)} left of {money(m.budgetCents, m.currency)}
                            </p>
                          </div>
                          <StatusChip meta={mandateStatus(m.status)} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card>
                <CardHeader eyebrow="Latest" />
                {notes === undefined ? (
                  <Skeleton className="h-24" />
                ) : notes.length === 0 ? (
                  <p className="text-sm text-muted">Updates on your promises show up here.</p>
                ) : (
                  <ul className="space-y-3">
                    {notes.map((n) => {
                      const href = streamHref(n.kind, n.stream);
                      const inner = (
                        <>
                          <p className="text-sm text-ink">{n.title}</p>
                          <p className="text-xs text-muted">
                            <RelativeTime at={n.at} />
                          </p>
                        </>
                      );
                      return <li key={n._id}>{href ? <Link href={href}>{inner}</Link> : inner}</li>;
                    })}
                  </ul>
                )}
              </Card>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
