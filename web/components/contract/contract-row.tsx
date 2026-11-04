"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Chip, StatusChip } from "@/components/ui/chip";
import { RelativeTime } from "@/components/ui/time";
import type { ContractCard } from "@/lib/convex";
import { money } from "@/lib/format";
import { contractStatus } from "@/lib/status";

/** One promise in a list: status, my side, and where the money is. */
export function ContractRow({ c }: { c: ContractCard }) {
  const meta = contractStatus(c.status);
  return (
    <Link href={`/contracts/${c._id}`} className="group flex flex-col gap-4 rounded-card bg-surface p-5 transition-shadow hover:shadow-lift sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip meta={meta} />
          <Chip tone="neutral">{c.myRole === "funder" ? "You pay" : c.myRole === "payee" ? "You get paid" : "Creator"}</Chip>
          {c.verified && <Chip tone="ok">Proved</Chip>}
          {!c.counterpartyJoined && <Chip tone="warn">Waiting for the other side</Chip>}
        </div>
        <p className="mt-3 truncate text-lg tracking-[-0.03em]">{c.title}</p>
        <p className="mt-0.5 text-xs text-muted">
          {meta.hint} · updated <RelativeTime at={c.updatedAt} />
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-6">
        <dl className="tabular grid grid-cols-3 gap-5 text-right text-sm">
          <div>
            <dt className="text-xs text-faint">Promise</dt>
            <dd>{money(c.principalCents, c.currency ?? "USD")}</dd>
          </div>
          <div>
            <dt className="text-xs text-faint">Held</dt>
            <dd>{money(c.heldCents, c.currency ?? "USD")}</dd>
          </div>
          <div>
            <dt className="text-xs text-faint">Released</dt>
            <dd>{money(c.releasedCents, c.currency ?? "USD")}</dd>
          </div>
        </dl>
        <ArrowUpRight className="size-4 text-faint transition-colors group-hover:text-ink" />
      </div>
    </Link>
  );
}
