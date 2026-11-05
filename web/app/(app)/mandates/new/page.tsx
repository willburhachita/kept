"use client";

import { DEFAULT_FEE_BPS, EXAMPLE_PROMPTS, authorizationAmount, formatCents, maxFee, officeSuppliesMandate, validateMandate, verifyMandate, type MandatePolicy } from "@kept/core";
import { useAction, useMutation } from "convex/react";
import { Check, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Notice, Select, Textarea } from "@/components/ui/field";
import { PageHeader, SectionLabel } from "@/components/ui/type";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/convex";
import { errorCode, errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** Form state in dollars and comma lists; converted to cents for the policy. */
interface Form {
  title: string;
  purpose: string;
  currency: string;
  budget: string;
  perPurchase: string;
  maxPurchases: string;
  approvalAbove: string;
  merchants: string;
  maxPerHour: string;
  expiresHours: string;
}

const toForm = (p: Omit<MandatePolicy, "version">): Form => ({
  title: p.title,
  purpose: p.purpose,
  currency: p.currency,
  budget: (p.budgetCents / 100).toString(),
  perPurchase: (p.perPurchaseMaxCents / 100).toString(),
  maxPurchases: String(p.maxPurchases),
  approvalAbove: p.approvalAboveCents === null ? "" : (p.approvalAboveCents / 100).toString(),
  merchants: p.allowedMerchants.join(", "),
  maxPerHour: String(p.maxPerHour),
  expiresHours: String(p.expiresAfterHours),
});

const cents = (s: string) => Math.round(Number(s || "0") * 100);

function toPolicy(f: Form): unknown {
  return {
    version: 1,
    title: f.title.trim(),
    purpose: f.purpose.trim(),
    currency: f.currency,
    budgetCents: cents(f.budget),
    perPurchaseMaxCents: cents(f.perPurchase),
    maxPurchases: Number(f.maxPurchases || "0"),
    approvalAboveCents: f.approvalAbove.trim() === "" ? null : cents(f.approvalAbove),
    allowedMerchants: f.merchants
      .split(/[,\n]/)
      .map((x) => x.trim())
      .filter(Boolean),
    maxPerHour: Number(f.maxPerHour || "0"),
    expiresAfterHours: Number(f.expiresHours || "0"),
  };
}

export default function NewMandatePage() {
  const draft = useAction(api.mandates.draftFromPrompt);
  const create = useMutation(api.mandates.create);
  const router = useRouter();
  const toast = useToast();
  const [prompt, setPrompt] = useState<string>(EXAMPLE_PROMPTS.mandate);
  const [drafting, setDrafting] = useState(false);
  const [aiNote, setAiNote] = useState<{ tone: "blue" | "warn"; text: string } | null>(null);
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [form, setForm] = useState<Form>(() => toForm(officeSuppliesMandate));
  const [creating, setCreating] = useState(false);
  const [deferred, setDeferred] = useState(form);
  useEffect(() => {
    const id = setTimeout(() => setDeferred(form), 300);
    return () => clearTimeout(id);
  }, [form]);

  const checked = useMemo(() => {
    const v = validateMandate(toPolicy(deferred));
    return v.ok ? { ok: true as const, policy: v.value, report: verifyMandate(v.value, DEFAULT_FEE_BPS, { requests: 4000 }), issues: v.issues } : { ok: false as const, issues: v.issues };
  }, [deferred]);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onDraft() {
    setDrafting(true);
    setAiNote(null);
    try {
      const r = await draft({ prompt });
      const { version: _v, ...p } = r.policy as MandatePolicy;
      setForm(toForm(p));
      setAssumptions(r.assumptions);
      setAiNote({ tone: "blue", text: "Claude filled in the policy below. Check every number: this is what your agent will be held to." });
    } catch (e) {
      const code = errorCode(e);
      setAiNote({ tone: "warn", text: code === "CONFIG_MISSING" ? "AI drafting isn't switched on for this deployment yet. Fill in the policy below by hand; it's verified the same way." : errorMessage(e) });
    } finally {
      setDrafting(false);
    }
  }

  async function onCreate() {
    if (!checked.ok) return;
    setCreating(true);
    try {
      const r = await create({ policy: checked.policy, prompt });
      toast({ title: r.verified ? "Policy verified" : "Saved as a draft", body: r.verified ? "Fund it to switch the agent on." : "Fix the failing checks before funding.", tone: r.verified ? "ok" : "neutral" });
      router.push(`/mandates/${r.mandateId}`);
    } catch (e) {
      toast({ title: "Couldn't create it", body: errorMessage(e), tone: "bad" });
      setCreating(false);
    }
  }

  const p = checked.ok ? checked.policy : null;
  return (
    <>
      <PageHeader eyebrow={<SectionLabel index="01">New agent budget</SectionLabel>} title="Give an agent a budget, not your card." description="Describe what it may buy. Kept turns that into a policy, proves the caps hold against hostile agents, and holds the budget on PayPal." />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader eyebrow="Describe it" title="In plain English" />
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={2000} aria-label="Describe the agent budget" className="min-h-28" />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted">Claude drafts the policy. It can't approve anything itself.</p>
              <Button variant="secondary" loading={drafting} onClick={onDraft} icon={<Sparkles className="size-4" />}>
                Draft the policy
              </Button>
            </div>
            {aiNote && (
              <Notice tone={aiNote.tone} className="mt-4">
                {aiNote.text}
              </Notice>
            )}
            {assumptions.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
                {assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader eyebrow="The policy" title="What your agent is held to" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" className="sm:col-span-2">
                {(pp) => <Input {...pp} value={form.title} onChange={set("title")} maxLength={80} />}
              </Field>
              <Field label="What it may buy" hint="Shown to you and to the AI screener for every purchase." className="sm:col-span-2">
                {(pp) => <Textarea {...pp} value={form.purpose} onChange={set("purpose")} className="min-h-20" maxLength={500} />}
              </Field>
              <Field label="Total budget">{(pp) => <Input {...pp} inputMode="decimal" value={form.budget} onChange={set("budget")} />}</Field>
              <Field label="Currency">
                {(pp) => (
                  <Select {...pp} value={form.currency} onChange={set("currency")}>
                    {["USD", "EUR", "GBP", "CAD", "AUD"].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Most per purchase">{(pp) => <Input {...pp} inputMode="decimal" value={form.perPurchase} onChange={set("perPurchase")} />}</Field>
              <Field label="Ask me above" optional hint="Leave empty to never ask inside the limits.">
                {(pp) => <Input {...pp} inputMode="decimal" value={form.approvalAbove} onChange={set("approvalAbove")} />}
              </Field>
              <Field label="Most purchases in total">{(pp) => <Input {...pp} inputMode="numeric" value={form.maxPurchases} onChange={set("maxPurchases")} />}</Field>
              <Field label="Most purchases per hour">{(pp) => <Input {...pp} inputMode="numeric" value={form.maxPerHour} onChange={set("maxPerHour")} />}</Field>
              <Field label="Expires after (hours)" hint="At most 28 days, so PayPal's hold never lapses.">
                {(pp) => <Input {...pp} inputMode="numeric" value={form.expiresHours} onChange={set("expiresHours")} />}
              </Field>
              <Field label="Only these merchants" optional hint="Exact emails, or @domain.com for a whole domain. Comma separated. Empty means any merchant.">
                {(pp) => <Input {...pp} value={form.merchants} onChange={set("merchants")} />}
              </Field>
            </div>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card tone="dark">
            <p className="eyebrow text-white/45">Live check</p>
            {checked.ok && p ? (
              <>
                <p className="tabular mt-3 text-[2.5rem] leading-none tracking-[-0.06em]">{formatCents(authorizationAmount(p.budgetCents, DEFAULT_FEE_BPS), p.currency)}</p>
                <p className="mt-2 text-sm text-white/55">
                  PayPal hold: {formatCents(p.budgetCents, p.currency)} budget + up to {formatCents(maxFee(p.budgetCents, DEFAULT_FEE_BPS), p.currency)} in fees. Unused budget is released when it closes.
                </p>
                <ul className="mt-6 space-y-2.5">
                  {checked.report.properties.map((x) => (
                    <li key={x.id} className="flex gap-2.5 text-sm">
                      <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full", x.status === "proved" ? "bg-pp" : "bg-bad")}>
                        {x.status === "proved" ? <Check className="size-2.5" /> : <X className="size-2.5" />}
                      </span>
                      <span>
                        <span className="text-white/90">{x.title}</span>
                        <span className="block text-xs text-white/45">{x.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="tabular mt-5 text-xs text-white/40">Checked against {checked.report.stats.simulatedRequests.toLocaleString()} simulated hostile purchase attempts.</p>
              </>
            ) : (
              <ul className="mt-4 space-y-2 text-sm text-white/75">
                {checked.issues.map((i) => (
                  <li key={`${i.path}${i.message}`}>
                    {i.path.replace(/^\$\.?/, "") || "policy"}: {i.message}
                  </li>
                ))}
              </ul>
            )}
            <Button variant="inverse" size="lg" className="mt-7 w-full" disabled={!checked.ok} loading={creating} onClick={onCreate}>
              Create agent budget
            </Button>
            <p className="mt-3 text-center text-xs text-white/40">Nothing is charged until you fund it.</p>
          </Card>
        </aside>
      </div>
    </>
  );
}
