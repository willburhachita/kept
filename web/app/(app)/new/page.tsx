"use client";

import { DEFAULT_FEE_BPS, EXAMPLES, EXAMPLE_PROMPTS, formatCents, type ContractIR } from "@kept/core";
import { useAction } from "convex/react";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Notice, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/misc";
import { PageHeader, SectionLabel } from "@/components/ui/type";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/convex";
import { errorMessage } from "@/lib/errors";
import { findRedFlags } from "@/lib/safety";
import { cn } from "@/lib/utils";

const TEMPLATES: { id: string; label: string; prompt: string; ir: ContractIR }[] = [
  { id: "logo", label: "Logo design, $300", prompt: EXAMPLE_PROMPTS.logo, ir: EXAMPLES.logoFixed },
  { id: "plumber", label: "Plumber visit, $180", prompt: EXAMPLE_PROMPTS.plumber, ir: EXAMPLES.plumberVisit },
];

export default function NewPromisePage() {
  const create = useAction(api.contracts.create);
  const compile = useAction(api.compiler.compile);
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<"describe" | "template">("describe");
  const [role, setRole] = useState<"funder" | "payee">("funder");
  const [prompt, setPrompt] = useState("");
  const [template, setTemplate] = useState(TEMPLATES[0]!.id);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(prompt), 400);
    return () => clearTimeout(id);
  }, [prompt]);
  const flags = useMemo(() => findRedFlags(debounced), [debounced]);
  const t = TEMPLATES.find((x) => x.id === template)!;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const usingTemplate = mode === "template";
      const r = await create({
        prompt: usingTemplate ? t.prompt : prompt.trim(),
        role,
        counterpartyEmail: email.trim() || undefined,
        ir: usingTemplate ? t.ir : undefined,
      });
      try {
        sessionStorage.setItem(`kept:invite:${r.contractId}`, r.inviteUrl);
      } catch {
        /* storage unavailable */
      }
      // Templates are proved right away; plain English goes through Claude first (it keeps running server-side).
      if (!usingTemplate) compile({ contractId: r.contractId }).catch((err) => toast({ title: "Writing the rules stopped", body: errorMessage(err), tone: "bad" }));
      router.push(`/contracts/${r.contractId}`);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow={<SectionLabel index="01">New promise</SectionLabel>} title="Make a promise." description="Say what's being paid for and when. Kept turns it into rules, proves them, and only then asks anyone to pay." />
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card className="p-6 sm:p-8">
          <form onSubmit={onSubmit} className="space-y-7">
            <div>
              <p className="mb-2 text-sm text-muted">I am</p>
              <Segmented
                label="Your role"
                value={role}
                onChange={setRole}
                options={[
                  { value: "funder", label: "Paying" },
                  { value: "payee", label: "Getting paid" },
                ]}
              />
            </div>

            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted">The deal</p>
                <Segmented
                  size="sm"
                  label="How to start"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "describe", label: "Describe it" },
                    { value: "template", label: "Proved template" },
                  ]}
                />
              </div>
              {mode === "describe" ? (
                <>
                  <Textarea
                    aria-label="Describe the deal"
                    required
                    minLength={20}
                    maxLength={4000}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Pay the designer $300. $100 now, $200 when she delivers the final logo as an SVG. Refund me if nothing arrives in 7 days."
                    className="min-h-44 text-[17px] leading-relaxed tracking-[-0.02em]"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="text-xs text-faint">Try:</span>
                    {TEMPLATES.map((x) => (
                      <button key={x.id} type="button" onClick={() => setPrompt(x.prompt)} className="rounded-full bg-black/[0.05] px-3 py-1 text-xs text-muted hover:bg-black/10 hover:text-ink">
                        {x.label}
                      </button>
                    ))}
                  </div>
                  {flags.length > 0 && (
                    <Notice tone="warn" className="mt-4" icon={<ShieldAlert className="size-4" />} title="This reads like a common scam pattern">
                      <ul className="mt-1 space-y-1">
                        {flags.map((f) => (
                          <li key={f.id}>
                            <strong className="font-medium">{f.title}.</strong> {f.advice}
                          </li>
                        ))}
                      </ul>
                    </Notice>
                  )}
                </>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {TEMPLATES.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      onClick={() => setTemplate(x.id)}
                      className={cn("rounded-2xl border p-4 text-left transition-colors", template === x.id ? "border-ink bg-sunken" : "border-line hover:border-line-2")}
                    >
                      <p className="text-[15px] text-ink">{x.ir.title}</p>
                      <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted">{x.prompt}</p>
                      <p className="tabular mt-3 text-xs text-ink-2">
                        {formatCents(x.ir.principalCents, x.ir.currency)} · {x.ir.guarantees.length} promises · already proved
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Field label={role === "funder" ? "Who's getting paid? (their email)" : "Who's paying? (their email)"} optional hint="We'll make a one-time invite link for them. You can also share it yourself.">
              {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />}
            </Field>

            {error && <Notice tone="bad">{error}</Notice>}
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
              <p className="text-xs text-muted">Nothing is charged now. Money moves only after both of you approve proved terms.</p>
              <Button type="submit" size="lg" loading={pending} iconRight={<ArrowRight className="size-4" />} disabled={mode === "describe" && prompt.trim().length < 20}>
                {mode === "describe" ? "Write & prove the rules" : "Use this template"}
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          <Card tone="dark">
            <p className="eyebrow text-white/45">What happens next</p>
            <ol className="mt-5 space-y-5">
              {[
                ["Claude writes it down", "Promises (what each side is owed) and rules (when money moves). It flags anything vague."],
                ["The verifier proves it", "Every order of deliveries, reviews and deadlines. If a rule can break a promise, Claude repairs the rules, never your promises."],
                ["You both approve", "The exact proved terms, fingerprinted. Then the payer puts the money on hold with PayPal."],
                ["Kept keeps it", "Accepted deliveries release money; missed deadlines return it. Every step signed."],
              ].map(([t1, d], i) => (
                <li key={t1} className="flex gap-4">
                  <span className="tabular text-sm text-white/35">0{i + 1}</span>
                  <div>
                    <p className="text-[15px]">{t1}</p>
                    <p className="mt-1 text-sm leading-relaxed text-white/55">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          <Card tone="sunken">
            <p className="text-sm text-ink">Cost</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {(DEFAULT_FEE_BPS / 100).toFixed(1)}% of money actually released, taken as it&apos;s released. Nothing on refunds. On a $300 deal that&apos;s at most $7.50.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
