"use client";

import { useState } from "react";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { Segmented } from "@/components/ui/misc";
import { SectionGrid, Statement } from "@/components/ui/type";
import { CheckLinkTool, ProveTool, VerifyReceiptsTool } from "@/components/verify/tools";

type Tab = "link" | "receipts" | "prove";

const INTRO: Record<Tab, { lead: string; tail: string }> = {
  link: { lead: "Check a link before you trust it.", tail: "Look-alike sites are how most payment scams start." },
  receipts: { lead: "Verify a promise's history yourself.", tail: "Every receipt is signed; nobody can quietly rewrite one." },
  prove: { lead: "Prove any contract in your browser.", tail: "The same verifier Kept runs before anyone pays." },
};

export default function VerifyPage() {
  const [tab, setTab] = useState<Tab>("link");
  return (
    <>
      <SiteNav />
      <main className="px-5 pb-28 pt-36">
        <div className="mx-auto max-w-6xl">
          <SectionGrid label="Trust tools">
            <Statement as="h1" lead={INTRO[tab].lead} tail={INTRO[tab].tail} />
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted">No account needed. Everything here runs in your browser against Kept&apos;s published keys and public log, so you don&apos;t have to take our word for anything.</p>
            <Segmented
              className="mt-8"
              label="Tool"
              value={tab}
              onChange={setTab}
              options={[
                { value: "link", label: "Check a link" },
                { value: "receipts", label: "Verify receipts" },
                { value: "prove", label: "Prove a contract" },
              ]}
            />
            <div className="mt-8">
              {tab === "link" && <CheckLinkTool />}
              {tab === "receipts" && <VerifyReceiptsTool />}
              {tab === "prove" && <ProveTool />}
            </div>
          </SectionGrid>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
