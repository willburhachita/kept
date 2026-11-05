"use client";

import type { Currency, VerificationReport } from "@kept/core";
import { useQuery } from "convex/react";
import { ArrowLeft, Snowflake } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { EvidencePanel } from "@/components/contract/evidence";
import { DeadlineRuler, MoneyRiver } from "@/components/contract/money";
import { ActionBar, ApprovePanel, Certificate, EditTermsPanel, FundPanel, InviteCard, PartiesCard, SafetyPanel } from "@/components/contract/panels";
import { ProofTimeline } from "@/components/contract/proof-timeline";
import { ReceiptChain } from "@/components/contract/receipts";
import { ReportView } from "@/components/contract/report-view";
import { TermsCard } from "@/components/contract/terms";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip, StatusChip } from "@/components/ui/chip";
import { Notice } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import { RelativeTime } from "@/components/ui/time";
import { api, type Id } from "@/lib/convex";
import { contractStatus } from "@/lib/status";

// AG Grid is large: load the money trail only on pages that show it.
const MoneyTrail = dynamic(() => import("@/components/contract/money-trail").then((m) => m.MoneyTrail), { ssr: false, loading: () => <Skeleton className="h-96 rounded-card" /> });

type Stage = "build" | "review" | "fund" | "live" | "cancelled";

function stageOf(status: string): Stage {
  if (status === "review") return "review";
  if (status === "awaiting_funding" || status === "funding") return "fund";
  if (status === "cancelled") return "cancelled";
  if (["active", "settling", "settled", "frozen"].includes(status)) return "live";
  return "build";
}

function Room() {
  const { id } = useParams<{ id: string }>();
  const contractId = id as Id<"contracts">;
  const c = useQuery(api.contracts.get, { contractId });
  const run = useQuery(api.compiler.latestRun, { contractId });

  if (c === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-12 w-2/3" />
        <div className="grid gap-4 lg:grid-cols-[1.65fr_1fr]">
          <Skeleton className="h-96 rounded-card" />
          <Skeleton className="h-64 rounded-card" />
        </div>
      </div>
    );
  }

  const meta = contractStatus(c.status);
  const stage = stageOf(c.status);
  const report = c.verification?.report as VerificationReport | undefined;
  const currency = (c.ir?.currency ?? "USD") as Currency;
  const principal = c.ir?.principalCents ?? 0;
  const roleLabel = c.myRole === "funder" ? "You're paying" : c.myRole === "payee" ? "You're getting paid" : c.staff ? "Staff view" : "You created this";
  const wasActivated = Boolean(c.activatedAt);

  return (
    <>
      <Link href="/contracts" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Promises
      </Link>
      <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip meta={meta} />
            <Chip tone="neutral">{roleLabel}</Chip>
            {c.verification?.ok && c.verification.current && <Chip tone="ok">Proved</Chip>}
            {c.money && <Chip tone="neutral">{c.money.principal}</Chip>}
          </div>
          <h1 className="mt-4 text-[clamp(1.875rem,3.4vw,2.75rem)] leading-[1.08] tracking-[-0.045em]">{c.rendered?.title ?? (c.prompt.slice(0, 80) || "New promise")}</h1>
          <p className="mt-2 max-w-2xl text-[15px] text-muted">
            {meta.hint}
            {c.nextDeadline?.at && stage === "live" && c.status === "active" ? (
              <>
                {" "}
                Next deadline: {c.nextDeadline.label}, <RelativeTime at={c.nextDeadline.at} />.
              </>
            ) : null}
          </p>
        </div>
        <ActionBar c={c} />
      </header>

      {c.frozen && (
        <Notice tone="bad" className="mb-4" icon={<Snowflake className="size-4" />} title="Money is paused">
          {c.frozen.reason} An arbiter reviews frozen promises; nothing moves until they resume it.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.65fr_1fr]">
        <div className="min-w-0 space-y-4">
          {stage === "build" && (
            <>
              {run ? (
                <Card>
                  <ProofTimeline run={run} />
                </Card>
              ) : (
                <Card tone="sunken">
                  <p className="text-sm text-muted">No rules yet. Describe the deal below and Kept writes and proves them.</p>
                </Card>
              )}
              <EditTermsPanel c={c} />
              {report && !report.ok && c.status === "needs_attention" && (
                <Card>
                  <CardHeader eyebrow="Verifier report" title="What the verifier found" />
                  <ReportView report={report} currency={currency} principalCents={principal} />
                </Card>
              )}
              {c.status === "needs_attention" && <TermsCard c={c} />}
            </>
          )}

          {stage === "review" && (
            <>
              <ApprovePanel c={c} />
              <TermsCard c={c} />
              {report && (
                <Card>
                  <CardHeader eyebrow="The proof" title="Checked across every possible outcome" />
                  <ReportView report={report} currency={currency} principalCents={principal} />
                </Card>
              )}
              {run && (
                <Card>
                  <ProofTimeline run={run} />
                </Card>
              )}
            </>
          )}

          {stage === "fund" && (
            <>
              <FundPanel c={c} />
              <TermsCard c={c} compact />
            </>
          )}

          {stage === "live" && (
            <>
              {c.status === "settled" && <Certificate c={c} />}
              {wasActivated && <MoneyRiver c={c} />}
              {wasActivated && <EvidencePanel c={c} />}
              <TermsCard c={c} compact />
            </>
          )}

          {stage === "cancelled" && (
            <>
              <Notice title="This promise was cancelled">No money moved. You can start a new promise any time.</Notice>
              <TermsCard c={c} compact />
            </>
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          <InviteCard c={c} />
          <PartiesCard c={c} />
          {(stage === "review" || stage === "fund") && <SafetyPanel c={c} />}
          {stage === "live" && wasActivated && <DeadlineRuler c={c} />}
          <ReceiptChain contractId={c._id} />
        </aside>
      </div>
      {wasActivated && (
        <div className="mt-4">
          <MoneyTrail contractId={c._id} currency={currency} />
        </div>
      )}
    </>
  );
}

export default function ContractPage() {
  return (
    <Suspense>
      <Room />
    </Suspense>
  );
}
