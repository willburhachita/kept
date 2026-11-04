"use client";

import { useQuery } from "convex/react";
import { ArrowUpRight, Bot, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/chip";
import { EmptyState, Meter, Skeleton } from "@/components/ui/misc";
import { Countdown } from "@/components/ui/time";
import { PageHeader } from "@/components/ui/type";
import { api } from "@/lib/convex";
import { money } from "@/lib/format";
import { mandateStatus } from "@/lib/status";

export default function MandatesPage() {
  const rows = useQuery(api.mandates.listMine);
  return (
    <>
      <PageHeader
        title="Agent budgets"
        description="Give an AI agent a budget it can spend inside rules you can read. Every purchase is checked; anything above your line waits for you."
        actions={
          <Button href="/mandates/new" icon={<Plus className="size-4" />}>
            New agent budget
          </Button>
        }
      />
      {rows === undefined ? (
        <Skeleton className="h-28 rounded-card" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Bot className="size-5" />} title="No agent budgets yet" body="Describe what your agent may buy, put the budget on hold with PayPal, and hand the agent a scoped token instead of your card." action={<Button href="/mandates/new">Set one up</Button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((m) => (
            <Link key={m._id} href={`/mandates/${m._id}`} className="group rounded-card bg-surface p-6 transition-shadow hover:shadow-lift">
              <div className="flex items-start justify-between gap-3">
                <StatusChip meta={mandateStatus(m.status)} />
                <ArrowUpRight className="size-4 text-faint group-hover:text-ink" />
              </div>
              <p className="mt-4 text-xl tracking-[-0.035em]">{m.title}</p>
              <div className="mt-5 flex items-baseline justify-between">
                <p className="tabular text-2xl tracking-[-0.05em]">{money(m.remainingCents, m.currency)}</p>
                <p className="tabular text-sm text-muted">left of {money(m.budgetCents, m.currency)}</p>
              </div>
              <Meter className="mt-3" value={m.budgetCents - m.remainingCents} max={m.budgetCents} />
              <p className="mt-3 text-xs text-muted">
                {money(m.spentCents, m.currency)} spent
                {m.expiresAt && m.status === "active" ? (
                  <>
                    {" "}
                    · expires in <Countdown to={m.expiresAt} parts={2} />
                  </>
                ) : null}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
