"use client";

import { useQuery } from "convex/react";
import { FileSignature, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ContractRow } from "@/components/contract/contract-row";
import { EmptyState, Segmented, Skeleton } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/type";
import { api } from "@/lib/convex";

type Group = "all" | "action" | "live" | "draft" | "done";

const GROUPS: Record<Exclude<Group, "all">, string[]> = {
  action: ["review", "awaiting_funding", "funding", "needs_attention"],
  live: ["active", "settling", "frozen"],
  draft: ["draft", "compiling", "verifying"],
  done: ["settled", "cancelled"],
};

export default function ContractsPage() {
  const rows = useQuery(api.contracts.listMine);
  const [group, setGroup] = useState<Group>("all");
  const shown = rows?.filter((c) => group === "all" || GROUPS[group].includes(c.status));
  const count = (g: Exclude<Group, "all">) => rows?.filter((c) => GROUPS[g].includes(c.status)).length ?? 0;
  return (
    <>
      <PageHeader
        title="Promises"
        description="Everything you're paying for or getting paid for, with where every cent is right now."
        actions={
          <Button href="/new" icon={<Plus className="size-4" />}>
            New promise
          </Button>
        }
      />
      <Segmented
        className="mb-5 max-w-full overflow-x-auto"
        label="Filter"
        value={group}
        onChange={setGroup}
        options={[
          { value: "all", label: `All${rows ? ` ${rows.length}` : ""}` },
          { value: "action", label: `Needs action ${count("action")}` },
          { value: "live", label: `Live ${count("live")}` },
          { value: "draft", label: `Drafts ${count("draft")}` },
          { value: "done", label: `Done ${count("done")}` },
        ]}
      />
      {rows === undefined ? (
        <div className="space-y-3">
          <Skeleton className="h-28 rounded-card" />
          <Skeleton className="h-28 rounded-card" />
        </div>
      ) : shown && shown.length > 0 ? (
        <div className="space-y-3">
          {shown.map((c) => (
            <ContractRow key={c._id} c={c} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<FileSignature className="size-5" />}
          title={rows.length ? "Nothing in this group" : "No promises yet"}
          body={rows.length ? "Try another filter." : "Describe a deal in plain English and Kept proves the payment rules before anyone pays."}
          action={!rows.length && <Button href="/new">Make your first promise</Button>}
        />
      )}
    </>
  );
}
