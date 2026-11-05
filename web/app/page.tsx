/* eslint-disable @next/next/no-img-element */
import { DEFAULT_FEE_BPS, EXAMPLE_PROMPTS, formatCents, officeSuppliesMandate } from "@kept/core";
import { ArrowRight, ArrowUpRight, Check, EyeOff, FileWarning, Fingerprint, Globe, ReceiptText, ScanLine, UserCheck } from "lucide-react";
import { PayPalBadge } from "@/components/brand/paypal";
import { Accordion } from "@/components/landing/accordion";
import { FeeCalculator } from "@/components/landing/fee-calculator";
import { ProofDemo } from "@/components/landing/proof-demo";
import { Reveal } from "@/components/landing/reveal";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { SectionGrid, SectionLabel, Statement } from "@/components/ui/type";
import { PHOTOS, photo, site } from "@/lib/site";

const FEE = `${(DEFAULT_FEE_BPS / 100).toFixed(1)}%`;

const STEPS = [
  {
    index: "001",
    title: "Say it",
    body: "Describe the deal the way you'd say it out loud. Claude turns it into promises (what each side is owed) and rules (when money moves), and asks about anything vague.",
    tags: ["Plain English", "Promises", "Rules", "Questions"],
  },
  {
    index: "002",
    title: "Prove it",
    body: "The verifier tries every order in which deliveries, reviews and deadlines can happen. If any order breaks a promise, you see exactly how, and Claude repairs the rules, never your promises.",
    tags: ["Every outcome", "Counterexamples", "Repairs", "Bounds"],
  },
  {
    index: "003",
    title: "Hold it",
    body: "Both sides approve the exact proved terms, fingerprinted. The payer approves a hold on paypal.com. The money stays on PayPal; neither side can grab it.",
    tags: ["PayPal hold", "Fingerprint", "Locked payout email"],
  },
  {
    index: "004",
    title: "Keep it",
    body: "Accepted deliveries release their share. Missed deadlines return the rest. The AI checks deliveries but can only pass them into a challenge window; disputes go to a person.",
    tags: ["Releases", "Refunds", "Challenge window", "Arbiter", "Signed receipts"],
  },
];

const SAFETY = [
  { icon: FileWarning, title: "Fake payment proof", body: "The hold is real and visible on PayPal before work starts. Status comes from PayPal, never a screenshot." },
  { icon: EyeOff, title: "Paid, nothing delivered", body: "Nothing is released without accepted delivery. Missed deadlines return the money by rule." },
  { icon: ScanLine, title: "Refund-the-difference", body: "Amounts are fixed in the proved terms. There is no difference to send back." },
  { icon: UserCheck, title: "Swapped payout details", body: "The payee's PayPal email locks at approval. Only an arbiter can change it, on the record." },
  { icon: Globe, title: "Look-alike sites", body: "Kept warns on any address that isn't its own, and anyone can check a link before signing in." },
  { icon: Fingerprint, title: "Tampered records", body: "Every step is signed and hash-chained. Verify the whole history in your browser." },
];

const USES = [
  { img: PHOTOS.womanDesk, alt: "A designer working at her desk", tags: ["Freelance", "Milestones"], title: "A logo, paid on delivery", body: "$100 to start, $200 when the SVG arrives and passes the checks." },
  { img: PHOTOS.plumberBathroom, alt: "A plumber repairing pipes in a bathroom", tags: ["Home services", "Photo proof"], title: "The leak, actually fixed", body: "$40 call-out on check-in, $140 when the photo shows a dry sink." },
  { img: PHOTOS.fruitStandPhone, alt: "A market vendor holding her phone at a fruit stand", tags: ["Suppliers", "Delivery"], title: "Stock delivered, supplier paid", body: "Pay for the crates that arrive. Get the rest back if they don't." },
];

const FAQ = [
  { title: "Is this real money?", body: "This build runs on the PayPal sandbox, so no real money moves. The same code runs live with production PayPal credentials." },
  { title: "Who actually holds the money?", body: "PayPal. Kept asks PayPal to authorize a hold on the payer's account and tells PayPal when to capture, pay out, void or refund. Kept never sees card numbers or PayPal passwords." },
  { title: "What does “proved” mean?", body: "The verifier explores every reachable state of the deal (every order of deliveries, reviews and deadlines, including ties) and checks that money is conserved, nothing gets stuck, PayPal's time limits hold, and every promise holds on every outcome it covers." },
  { title: "What if the AI gets it wrong?", body: "The AI drafts rules and grades deliveries, but it can only propose or escalate. Rules must pass the verifier, both sides approve the exact terms, the payer can challenge any AI pass, and disputes go to a human arbiter." },
  { title: "What does it cost?", body: `${FEE} of the money that's actually released, charged as it's released. Nothing on refunds, nothing monthly.` },
  { title: "Can I use it inside my own platform?", body: "Yes. Marketplaces and apps can create, fund and track promises through the REST API, the @kept/sdk package, signed webhooks, and an MCP server for AI agents." },
];

export default function Home() {
  const m = officeSuppliesMandate;
  return (
    <>
      <SiteNav overDark />

      {/* Hero: dark inset panel, giant wordmark */}
      <section className="p-1.5 sm:p-2">
        <div className="relative flex min-h-[calc(100svh-0.75rem)] flex-col justify-end overflow-hidden rounded-card bg-ink text-white">
          <img src={photo(PHOTOS.fruitStandPhone, 2400)} alt="" className="absolute inset-0 size-full object-cover object-[60%_30%]" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/45 to-ink/25" />
          <div className="relative grid gap-10 px-6 pb-8 pt-36 sm:px-10 sm:pb-10 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="animate-rise text-[clamp(5.5rem,19vw,15.5rem)] font-bold leading-[0.82] tracking-[-0.075em]">
                Kept<span className="text-pp">.</span>
              </p>
              <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-sm font-semibold tracking-[-0.02em]">
                <span>Proved before paid</span>
                <span>Held by PayPal</span>
                <span>{FEE} only when released</span>
              </div>
              <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/65">
                Describe a deal in plain English. Kept writes the payment rules, proves they can&apos;t break your promise, holds the money on PayPal, and releases it only when the promise is kept.
              </p>
            </div>
            <div className="flex flex-col items-start gap-5 lg:max-w-xs lg:items-end lg:text-right">
              <p className="text-[clamp(1.25rem,1.8vw,1.5rem)] font-semibold leading-[1.15] tracking-[-0.04em]">Get paid for the work. Not for the argument.</p>
              <PayPalBadge dark text="Money held by PayPal, never by a stranger" />
              <div className="flex flex-wrap gap-2">
                <Button href="/signin?mode=signUp" variant="inverse" iconRight={<ArrowRight className="size-4" />}>
                  Make a promise
                </Button>
                <Button href="/#proof" variant="inverse-ghost">
                  See the proof
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Why */}
      <section className="px-5 py-24 sm:py-32">
        <div className="mx-auto max-w-6xl">
          <SectionGrid label="Why Kept">
            <Reveal>
              <Statement lead="Most deals go wrong between doing the work and getting paid." tail="Kept closes that gap before anyone commits a cent." />
            </Reveal>
            <div className="mt-12 grid gap-3 md:grid-cols-[1.1fr_1fr_1fr]">
              <Reveal>
                <p className="max-w-sm text-[1.25rem] font-medium leading-snug tracking-[-0.035em] text-ink">
                  The money is already waiting on PayPal, and the rules for releasing it are proved, so nobody has to trust anybody&apos;s word.
                </p>
              </Reveal>
              <Reveal delay={80}>
                <div className="flex h-full min-h-56 flex-col justify-between rounded-card bg-surface p-6">
                  <div>
                    <p className="tabular text-[3.25rem] font-semibold leading-none tracking-[-0.06em]">100%</p>
                    <p className="mt-2 text-sm font-medium text-ink">of rules proved before funding</p>
                  </div>
                  <p className="text-sm leading-relaxed text-muted">If any order of events could break a promise, the promise can&apos;t be funded.</p>
                </div>
              </Reveal>
              <Reveal delay={160}>
                <div className="flex h-full min-h-56 flex-col justify-between rounded-card bg-surface p-6">
                  <div>
                    <p className="tabular text-[3.25rem] font-semibold leading-none tracking-[-0.06em]">$0</p>
                    <p className="mt-2 text-sm font-medium text-ink">in money the other side can touch</p>
                  </div>
                  <p className="text-sm leading-relaxed text-muted">PayPal holds it. It moves only when a proved rule says so.</p>
                </div>
              </Reveal>
            </div>
          </SectionGrid>
        </div>
      </section>

      {/* Proof */}
      <section id="proof" className="scroll-mt-24 px-5 pb-24 sm:pb-32">
        <div className="mx-auto max-w-6xl">
          <SectionGrid label="The proof, live">
            <Reveal className="mb-10 grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:items-end">
              <Statement lead="A first draft that looks right." tail="And the bug that would have cost the designer $200." />
              <p className="text-[15px] leading-relaxed text-muted">This is the real verifier, running in your browser on the rules an AI first wrote for this deal. Press run and watch it find the one order of events that breaks a promise.</p>
            </Reveal>
          </SectionGrid>
          <Reveal>
            <ProofDemo />
          </Reveal>
        </div>
      </section>

      {/* How it works: black numbered list */}
      <section id="how" className="scroll-mt-24 bg-ink px-5 py-28 text-white sm:py-40">
        <div className="mx-auto max-w-6xl">
          <SectionGrid label="How it works" dark>
            <h2 className="text-[clamp(2.5rem,5vw,3.75rem)] font-semibold leading-none tracking-[-0.055em]">Four steps</h2>
            <div className="mt-12">
              <Accordion variant="dark" items={STEPS} />
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Button href="/signin?mode=signUp" variant="inverse" size="lg">
                Get started
              </Button>
              <p className="tabular text-sm text-white/50">
                The logo deal: hold {formatCents(30_750)}, captures {formatCents(10_250)} + {formatCents(20_500)}, fee {formatCents(750)}.
              </p>
            </div>
          </SectionGrid>
        </div>
      </section>

      {/* Uses */}
      <section className="px-5 py-24 sm:py-32">
        <div className="mx-auto max-w-6xl">
          <SectionGrid label="Where it fits">
            <Reveal>
              <Statement lead="Any deal where one side does the work" tail="and the other side pays for it." />
            </Reveal>
          </SectionGrid>
          <div className="mt-12 grid gap-3 md:grid-cols-3">
            {USES.map((u, i) => (
              <Reveal key={u.title} delay={i * 80}>
                <article className="group">
                  <div className="relative aspect-[4/5] overflow-hidden rounded-card bg-ink">
                    <img src={photo(u.img, 900)} alt={u.alt} className="absolute inset-0 size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]" />
                    <div className="absolute left-4 top-4 flex gap-1.5">
                      {u.tags.map((t) => (
                        <Chip key={t} tone="glass">
                          {t}
                        </Chip>
                      ))}
                    </div>
                  </div>
                  <h3 className="mt-4 text-xl tracking-[-0.04em]">{u.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-muted">{u.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Safety */}
      <section id="safety" className="scroll-mt-24 px-5 pb-24 sm:pb-32">
        <div className="mx-auto max-w-6xl">
          <SectionGrid label="Scam protection">
            <Reveal className="grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:items-end">
              <Statement lead="Scams need money that moves on trust." tail="On Kept, money only moves on proof." />
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <Button href="/verify">Check a link</Button>
                <Button href="/docs/scam-protection" variant="secondary">
                  Safety guide
                </Button>
              </div>
            </Reveal>
            <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {SAFETY.map((s, i) => (
                <Reveal key={s.title} delay={(i % 3) * 70}>
                  <div className="flex h-full min-h-60 flex-col justify-between rounded-card bg-surface p-6">
                    <span className="flex size-11 items-center justify-center rounded-full border border-line text-ink">
                      <s.icon className="size-5" strokeWidth={1.6} />
                    </span>
                    <div className="mt-10">
                      <h3 className="text-[1.375rem] leading-tight tracking-[-0.04em]">{s.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </SectionGrid>
        </div>
      </section>

      {/* Numbers */}
      <section className="px-5 pb-24 sm:pb-32">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-y-12 border-y border-line py-14 md:grid-cols-4">
          {[
            ["6", "checks proved on every promise"],
            [FEE, "fee, only on released money"],
            ["28d", "longest hold, guarded before expiry"],
            ["<1s", "to prove a typical deal"],
          ].map(([n, l]) => (
            <div key={l} className="px-2">
              <p className="tabular text-[clamp(3rem,6vw,4.75rem)] font-semibold leading-none tracking-[-0.06em]">{n}</p>
              <p className="mt-3 max-w-[12rem] text-sm text-muted">{l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Agents */}
      <section id="agents" className="scroll-mt-24 px-5 pb-24 sm:pb-32">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <div className="grid gap-10 rounded-card bg-surface p-6 sm:p-10 lg:grid-cols-[1fr_1.05fr] lg:gap-14">
              <div className="flex flex-col">
                <SectionLabel>Agentic commerce</SectionLabel>
                <Statement className="mt-4" lead="Give an AI agent a budget," tail="not your card." />
                <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted">
                  Describe the budget in a sentence. Kept turns it into a verified policy, holds it on PayPal, and hands your agent a scoped token. A deterministic guard checks every purchase before an AI screener even looks at it.
                </p>
                <div className="mt-auto pt-8">
                  <div className="rounded-2xl bg-ink p-4 font-mono text-[12.5px] leading-relaxed text-white/85">
                    <p className="text-white/40"># connect any MCP client</p>
                    <p className="mt-1 break-all">claude mcp add --transport http kept {site.mcpUrl} --header &quot;Authorization: Bearer mt_…&quot;</p>
                  </div>
                </div>
              </div>
              <div className="rounded-card bg-canvas p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-lg font-semibold tracking-[-0.035em]">{m.title}</p>
                    <p className="mt-1 text-sm text-muted">&ldquo;{EXAMPLE_PROMPTS.mandate.slice(0, 84)}&hellip;&rdquo;</p>
                  </div>
                  <Chip tone="ok" live>
                    Live
                  </Chip>
                </div>
                <div className="mt-6 flex items-baseline justify-between">
                  <p className="tabular text-4xl font-semibold tracking-[-0.06em]">{formatCents(13_500)}</p>
                  <p className="tabular text-sm text-muted">left of {formatCents(m.budgetCents)}</p>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-black/[0.07]">
                  <div className="h-full bg-ink" style={{ width: "32.5%" }} />
                </div>
                <ul className="mt-6 space-y-2">
                  {[
                    { a: 2_500, w: "Printer paper, 5 reams", s: "Paid", t: "ok" as const },
                    { a: 4_000, w: "Toner cartridge", s: "Needs you", t: "warn" as const, n: "Above your $30 approval line" },
                    { a: 6_000, w: "Desk chair", s: "Denied", t: "bad" as const, n: "Over the $50 per-purchase limit" },
                  ].map((x) => (
                    <li key={x.w} className="flex items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-[15px]">
                          <span className="tabular font-medium">{formatCents(x.a)}</span> <span className="text-muted">{x.w}</span>
                        </p>
                        {x.n && <p className="text-xs text-faint">{x.n}</p>}
                      </div>
                      <Chip tone={x.t} dot>
                        {x.s}
                      </Chip>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-24 px-5 pb-24 sm:pb-32">
        <div className="mx-auto max-w-6xl">
          <SectionGrid label="Pricing">
            <Reveal className="mb-10">
              <Statement lead={`${FEE} of the money that's released.`} tail="Nothing on refunds. Nothing monthly." />
            </Reveal>
          </SectionGrid>
          <Reveal>
            <FeeCalculator />
          </Reveal>
        </div>
      </section>

      {/* Developers */}
      <section className="px-5 pb-24 sm:pb-32">
        <div className="mx-auto max-w-6xl">
          <SectionGrid label="For platforms">
            <Reveal className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
              <div className="flex flex-col rounded-card bg-surface p-6 sm:p-8">
                <h2 className="text-[clamp(1.75rem,3vw,2.375rem)] leading-[1.08] tracking-[-0.05em]">
                  Verified promises inside your marketplace. <span className="text-[#a3a3a3]">REST, SDK, webhooks and MCP.</span>
                </h2>
                <ul className="mt-8 space-y-3 text-[15px] text-ink-2">
                  {["One API key to create, fund and track promises", "Signed webhooks for every state change", "Receipts your users can verify without trusting you", "Scoped tokens and an MCP server for AI agents"].map((x) => (
                    <li key={x} className="flex items-start gap-3">
                      <Check className="mt-1 size-4 shrink-0 text-ok" /> {x}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto flex flex-wrap gap-2 pt-10">
                  <Button href="/docs/quickstart" iconRight={<ArrowUpRight className="size-4" />}>
                    Quickstart
                  </Button>
                  <Button href="/docs/api" variant="secondary">
                    API reference
                  </Button>
                </div>
              </div>
              <div className="overflow-hidden rounded-card bg-[#0b0b0c] text-[13px] leading-[1.75] text-white/85">
                <div className="flex items-center gap-2 border-b border-white/10 px-5 py-3 text-xs text-white/45">
                  <ReceiptText className="size-3.5" />
                  <span className="font-mono">checkout.ts</span>
                </div>
                <pre className="overflow-x-auto p-5 font-mono">
                  <code>
                    <span className="text-[#f9a8d4]">import</span> {"{ Kept }"} <span className="text-[#f9a8d4]">from</span> <span className="text-[#a7f3d0]">&quot;@kept/sdk&quot;</span>;{"\n\n"}
                    <span className="text-[#f9a8d4]">const</span> kept = <span className="text-[#f9a8d4]">new</span> <span className="text-[#7dd3fc]">Kept</span>({"{"} baseUrl, apiKey {"}"});{"\n\n"}
                    <span className="text-white/40">{"// Plain English in, proved contract out"}</span>
                    {"\n"}
                    <span className="text-[#f9a8d4]">const</span> {"{ contractId }"} = <span className="text-[#f9a8d4]">await</span> kept.contracts.<span className="text-[#93c5fd]">create</span>({"{"}
                    {"\n"}  role: <span className="text-[#a7f3d0]">&quot;funder&quot;</span>,{"\n"}  prompt: <span className="text-[#a7f3d0]">&quot;$100 now, $200 when the final SVG logo arrives&quot;</span>,{"\n"}  compile: <span className="text-[#7dd3fc]">true</span>,{"\n"}
                    {"}"});{"\n\n"}
                    <span className="text-white/40">{"// Send the payer to PayPal; the money is held there"}</span>
                    {"\n"}
                    <span className="text-[#f9a8d4]">const</span> {"{ approveUrl }"} = <span className="text-[#f9a8d4]">await</span> kept.contracts.<span className="text-[#93c5fd]">fund</span>(contractId);{"\n\n"}
                    <span className="text-white/40">{"// Every state change arrives as a signed webhook"}</span>
                    {"\n"}
                    <span className="text-[#f9a8d4]">const</span> event = <span className="text-[#93c5fd]">verifyWebhook</span>({"{"} secret, headers, body {"}"});
                  </code>
                </pre>
              </div>
            </Reveal>
          </SectionGrid>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-5 pb-28 sm:pb-40">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          <div>
            <h2 className="text-[clamp(5rem,12vw,9rem)] font-semibold leading-[0.85] tracking-[-0.07em]">FAQ</h2>
            <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-muted">The questions people ask before they pay. Anything else is in the docs.</p>
            <Button href="/docs/faq" variant="secondary" size="sm" className="mt-6">
              All questions
            </Button>
          </div>
          <Accordion items={FAQ} />
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
