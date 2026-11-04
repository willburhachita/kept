/* eslint-disable @next/next/no-img-element */
import { DEFAULT_FEE_BPS, EXAMPLE_PROMPTS, formatCents, officeSuppliesMandate } from "@kept/core";
import { ArrowRight, ArrowUpRight, Check, Clock3, Plus, X } from "lucide-react";
import Link from "next/link";
import { PayPalBadge } from "@/components/brand/paypal";
import { FeeCalculator } from "@/components/landing/fee-calculator";
import { ProofDemo } from "@/components/landing/proof-demo";
import { Reveal } from "@/components/landing/reveal";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { SectionLabel, Statement } from "@/components/ui/type";
import { PHOTOS, photo, site } from "@/lib/site";

const WHY = [
  { title: "Proved before paid", body: "An exhaustive verifier checks every order in which work, reviews and deadlines can happen. If a rule could break a promise, nobody can fund it." },
  { title: "Held by PayPal", body: "The money sits on a PayPal hold the whole time. The other side can see it's there; neither side can grab it." },
  { title: "AI checks, rules decide", body: "Claude writes the rules and checks the evidence, but it can only propose or escalate. Money moves only by the proved rules." },
  { title: "Receipts anyone can check", body: "Every step is signed and hash-chained. You can verify the whole history in your own browser, no trust required." },
];

const USES = [
  { img: PHOTOS.womanDesk, alt: "A designer working at her desk", tags: ["Freelance", "Milestones"], title: "A logo, paid on delivery", body: "$100 to start, $200 when the SVG arrives and passes the checks." },
  { img: PHOTOS.plumberBathroom, alt: "A plumber repairing pipes in a bathroom", tags: ["Home services", "Photo proof"], title: "The leak, actually fixed", body: "$40 call-out on check-in, $140 when the photo shows a dry sink." },
  { img: PHOTOS.fruitStandPhone, alt: "A market vendor holding her phone at a fruit stand", tags: ["Suppliers", "Delivery"], title: "Stock delivered, supplier paid", body: "Pay for the crates that arrive. Get the rest back if they don't." },
];

const THREATS = [
  { threat: "Fake payment screenshots", fix: "The hold is real and visible on PayPal before anyone starts. Status comes from PayPal, never from a screenshot." },
  { threat: "Work delivered, never paid", fix: "Once proved terms are funded, the payer can't take the money back. Accepted evidence or a passed deadline releases it automatically." },
  { threat: "Paid, nothing delivered", fix: "Nothing is released without accepted evidence. Missed deadlines return the money by rule, not by begging." },
  { threat: "Overpay, refund the difference", fix: "Amounts are fixed in the proved terms. There is no difference to send back, and no way to send it." },
  { threat: "Look-alike sites and links", fix: "Kept warns on any address that isn't its own, and anyone can check a link before they sign in." },
  { threat: "Swapped payout details", fix: "The payee's PayPal email is locked when they approve. Only an arbiter can change it, and the change is on the record." },
];

const FAQ = [
  { q: "Is this real money?", a: "This build runs on the PayPal sandbox, so no real money moves. The same code runs live with production PayPal credentials." },
  { q: "Who actually holds the money?", a: "PayPal. Kept asks PayPal to authorize a hold on the payer's account and tells PayPal when to capture, pay out, void or refund. Kept never sees card numbers or PayPal passwords." },
  { q: "What does “proved” mean?", a: "The verifier explores every reachable state of the deal (every order of deliveries, reviews and deadlines, including ties) and checks that money is conserved, nothing gets stuck, PayPal's time limits hold, and every promise holds on every outcome it covers. If any check fails, you see the exact sequence that breaks it." },
  { q: "What if the AI gets it wrong?", a: "The AI drafts rules and grades evidence, but it can only propose or escalate. Rules must pass the verifier, both sides approve the exact terms, the payer can challenge any AI pass, and disputes go to a human arbiter." },
  { q: "What does it cost?", a: `${(DEFAULT_FEE_BPS / 100).toFixed(1)}% of the money that's actually released, charged as it's released. Nothing on refunds, nothing monthly.` },
  { q: "Can I use it inside my own platform?", a: "Yes. Marketplaces and apps can create, fund and track promises through the REST API, the @kept/sdk package, signed webhooks, and an MCP server for AI agents." },
];

const MANDATE_FEED = [
  { amount: 2_500, what: "Printer paper, 5 reams", status: "Paid", tone: "ok" as const },
  { amount: 4_000, what: "Toner cartridge", status: "Needs you", tone: "warn" as const, note: "Above your $30 approval line" },
  { amount: 6_000, what: "Desk chair", status: "Denied", tone: "bad" as const, note: "Over the $50 per-purchase limit" },
];

export default function Home() {
  const m = officeSuppliesMandate;
  return (
    <>
      <SiteNav overDark />

      {/* Hero */}
      <section className="relative flex min-h-[100svh] flex-col justify-end overflow-hidden bg-ink text-white">
        <img src={photo(PHOTOS.fruitStandPhone, 2400)} alt="" className="absolute inset-0 size-full object-cover object-[50%_35%] opacity-90" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/45" />
        <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-5 pb-12 pt-40 md:grid-cols-[1fr_auto] md:items-end">
          <div className="max-w-2xl animate-rise">
            <PayPalBadge dark text="Money held by PayPal, never by a stranger" />
            <h1 className="mt-6 text-[clamp(2.6rem,6.2vw,4.9rem)] font-medium leading-[0.98] tracking-[-0.055em]">
              Get paid for the work. <span className="text-white/45">Not for the argument.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed tracking-[-0.02em] text-white/75">
              Describe a deal in plain English. Kept writes the payment rules, proves they can&apos;t break your promise, holds the money on PayPal, and releases it only when the promise is kept.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="/signin?mode=signUp" variant="inverse" size="lg" iconRight={<ArrowRight className="size-4" />}>
                Make a promise
              </Button>
              <Button href="/#proof" variant="inverse-ghost" size="lg">
                Watch it catch a bug
              </Button>
            </div>
          </div>
          <div className="hidden flex-col items-end gap-3 text-right text-[13px] uppercase leading-snug tracking-[0.01em] text-white/80 md:flex">
            <span className="rounded-full bg-white px-3 py-1.5 text-sm normal-case tracking-[-0.02em] text-ink">&rsquo;26</span>
            <p>
              Every promise,
              <br />
              kept.
            </p>
            <p className="mt-6 text-white/55">(Scroll down)</p>
          </div>
        </div>
      </section>

      {/* 01 Why */}
      <section className="px-5 py-24 sm:py-32">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <SectionLabel index="01">Why Kept</SectionLabel>
            <Statement
              className="mt-6 max-w-4xl"
              lead="Most deals go wrong in the gap between doing the work and getting paid for it."
              tail="Kept closes the gap: the money is already waiting, and the rules for releasing it are proved before anyone commits a cent."
            />
          </Reveal>
          <div className="mt-16 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {WHY.map((w, i) => (
              <Reveal key={w.title} delay={i * 80}>
                <span className="block size-2 rounded-full bg-ink" />
                <h3 className="mt-5 text-[1.375rem] leading-tight">{w.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-muted">{w.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 02 Proof */}
      <section id="proof" className="scroll-mt-24 px-5 pb-24 sm:pb-32">
        <div className="mx-auto max-w-6xl">
          <Reveal className="mb-10 grid gap-6 md:grid-cols-[1fr_1fr] md:items-end">
            <div>
              <SectionLabel index="02">The proof, live</SectionLabel>
              <Statement className="mt-6" lead="A first draft that looks right." tail="And the bug that would have cost the designer $200." />
            </div>
            <p className="max-w-md text-[15px] leading-relaxed text-muted md:justify-self-end">
              This is the real verifier, running in your browser on the exact rules an AI first wrote for this deal. Press run and watch it find the one order of events that breaks a promise.
            </p>
          </Reveal>
          <Reveal>
            <ProofDemo />
          </Reveal>
        </div>
      </section>

      {/* 03 Uses */}
      <section className="px-5 pb-24 sm:pb-32">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <SectionLabel index="03">Where it fits</SectionLabel>
            <Statement className="mt-6 max-w-3xl" lead="Any deal where one side does something and the other side pays for it." tail="Write it the way you'd say it." />
          </Reveal>
          <div className="mt-12 grid gap-3 md:grid-cols-6">
            {USES.map((u, i) => (
              <Reveal key={u.title} delay={i * 80} className={i === 0 ? "md:col-span-3 md:row-span-2" : "md:col-span-3"}>
                <article className={`group relative h-full overflow-hidden rounded-card bg-ink text-white ${i === 0 ? "min-h-[26rem] md:min-h-[36rem]" : "min-h-[17.5rem]"}`}>
                  <img src={photo(u.img, i === 0 ? 1400 : 1000)} alt={u.alt} className="absolute inset-0 size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
                  <div className="absolute left-4 top-4 flex gap-1.5">
                    {u.tags.map((t) => (
                      <Chip key={t} tone="glass-dark">
                        {t}
                      </Chip>
                    ))}
                  </div>
                  <div className="absolute inset-x-5 bottom-5 flex items-end justify-between gap-4">
                    <div>
                      <h3 className="text-[1.375rem] leading-tight">{u.title}</h3>
                      <p className="mt-1.5 max-w-sm text-sm text-white/70">{u.body}</p>
                    </div>
                    <Link href="/signin?mode=signUp" aria-label={`Start: ${u.title}`} className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-ink transition-transform group-hover:-rotate-45">
                      <ArrowRight className="size-4" />
                    </Link>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 04 Money flow */}
      <section id="how" className="scroll-mt-24 px-5 pb-24 sm:pb-32">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <SectionLabel index="04">How the money moves</SectionLabel>
            <Statement className="mt-6 max-w-3xl" lead="Four steps, every number shown." tail="Here is the logo deal, to the cent." />
          </Reveal>
          <ol className="mt-12 grid gap-3 md:grid-cols-4">
            {[
              { n: "01", t: "Say it", d: "Write the deal in plain English. Claude turns it into promises and rules, and asks about anything vague.", paypal: "Nothing moves yet" },
              { n: "02", t: "Prove it", d: "The verifier checks every possible order of events. Both of you approve the exact proved terms, fingerprinted.", paypal: "Nothing moves yet" },
              { n: "03", t: "Hold it", d: "The payer approves on paypal.com. The money stays on their PayPal, on hold, until a rule releases it.", paypal: `Hold of ${formatCents(30_750)} ($300 + at most $7.50 fee)` },
              { n: "04", t: "Kept", d: "Each kept promise releases its share. Missed deadlines return the rest. Every step is signed.", paypal: `Captures ${formatCents(10_250)} then ${formatCents(20_500)}; pays out $100 + $200` },
            ].map((s, i) => (
              <Reveal key={s.n} delay={i * 80} className="h-full">
                <li className={`flex h-full flex-col rounded-card p-6 ${i === 3 ? "bg-ink text-white" : "bg-surface"}`}>
                  <span className={`tabular text-sm ${i === 3 ? "text-white/45" : "text-faint"}`}>{s.n}</span>
                  <h3 className="mt-10 text-2xl">{s.t}</h3>
                  <p className={`mt-3 text-[15px] leading-relaxed ${i === 3 ? "text-white/65" : "text-muted"}`}>{s.d}</p>
                  <p className={`tabular mt-auto border-t pt-4 text-xs leading-relaxed ${i === 3 ? "border-white/10 text-pp-sky" : "border-line text-pp-deep"}`}>PayPal: {s.paypal}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* 05 Safety */}
      <section id="safety" className="scroll-mt-24 bg-ink px-5 py-24 text-white sm:py-32">
        <div className="mx-auto max-w-6xl">
          <Reveal className="grid gap-8 md:grid-cols-[1.3fr_1fr] md:items-end">
            <div>
              <SectionLabel index="05" dark>
                Scam protection
              </SectionLabel>
              <Statement dark className="mt-6" lead="Scams need one thing: money that moves on trust." tail="On Kept, money only moves on proof." />
            </div>
            <div className="flex flex-wrap gap-2 md:justify-end">
              <Button href="/verify" variant="inverse">
                Check a link someone sent you
              </Button>
              <Button href="/docs/scam-protection" variant="inverse-ghost">
                Safety guide
              </Button>
            </div>
          </Reveal>
          <div className="mt-14 grid gap-px overflow-hidden rounded-card bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
            {THREATS.map((t, i) => (
              <Reveal key={t.threat} delay={(i % 3) * 70} className="bg-ink">
                <div className="h-full p-6 sm:p-7">
                  <p className="flex items-center gap-2 text-sm text-[#ff8a70]">
                    <X className="size-4" /> {t.threat}
                  </p>
                  <p className="mt-4 text-[15px] leading-relaxed text-white/75">{t.fix}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 06 Agents */}
      <section id="agents" className="scroll-mt-24 px-5 py-24 sm:py-32">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <Reveal>
            <SectionLabel index="06">Agentic commerce</SectionLabel>
            <Statement className="mt-6" lead="Give an AI agent a budget, not your card." tail="It spends inside rules you can read, and asks you about anything else." />
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted">
              Describe the budget in a sentence. Kept turns it into a verified policy, holds the budget on PayPal, and hands your agent a scoped token. Every purchase is checked by a deterministic guard before an AI screener even looks at it.
            </p>
            <div className="mt-8 rounded-2xl bg-ink p-4 font-mono text-[13px] leading-relaxed text-white/85">
              <p className="text-white/40"># connect any MCP client (Claude, Cursor, your own agent)</p>
              <p className="mt-1 break-all">
                claude mcp add --transport http kept {site.mcpUrl} --header &quot;Authorization: Bearer mt_…&quot;
              </p>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <div className="rounded-card bg-surface p-6 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xl tracking-[-0.03em]">{m.title}</p>
                  <p className="mt-1 text-sm text-muted">&ldquo;{EXAMPLE_PROMPTS.mandate.slice(0, 92)}…&rdquo;</p>
                </div>
                <Chip tone="ok" live>
                  Live
                </Chip>
              </div>
              <div className="mt-6">
                <div className="flex items-baseline justify-between">
                  <p className="tabular text-3xl tracking-[-0.05em]">{formatCents(13_500)}</p>
                  <p className="tabular text-sm text-muted">left of {formatCents(m.budgetCents)}</p>
                </div>
                <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-black/[0.06]">
                  <div className="h-full bg-ink" style={{ width: "32.5%" }} />
                  <div className="h-full bg-pp" style={{ width: "0%" }} />
                </div>
                <div className="tabular mt-3 grid grid-cols-3 gap-2 text-xs text-muted">
                  <span>≤ {formatCents(m.perPurchaseMaxCents)} each</span>
                  <span>asks above {formatCents(m.approvalAboveCents ?? 0)}</span>
                  <span>{m.maxPerHour} per hour max</span>
                </div>
              </div>
              <ul className="mt-6 divide-y divide-line border-t border-line">
                {MANDATE_FEED.map((s) => (
                  <li key={s.what} className="flex items-center justify-between gap-4 py-3.5">
                    <div className="min-w-0">
                      <p className="truncate text-[15px]">
                        <span className="tabular">{formatCents(s.amount)}</span> <span className="text-muted">· {s.what}</span>
                      </p>
                      {s.note && <p className="mt-0.5 text-xs text-faint">{s.note}</p>}
                    </div>
                    <Chip tone={s.tone} dot>
                      {s.status}
                    </Chip>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 07 Pricing */}
      <section id="pricing" className="scroll-mt-24 px-5 pb-24 sm:pb-32">
        <div className="mx-auto max-w-6xl">
          <Reveal className="mb-10">
            <SectionLabel index="07">Pricing</SectionLabel>
            <Statement className="mt-6 max-w-3xl" lead={`${(DEFAULT_FEE_BPS / 100).toFixed(1)}% of the money that's released.`} tail="Nothing on refunds. Nothing monthly. Every number below, before you sign anything." />
          </Reveal>
          <Reveal>
            <FeeCalculator />
          </Reveal>
        </div>
      </section>

      {/* 08 Developers */}
      <section className="px-5 pb-24 sm:pb-32">
        <div className="mx-auto max-w-6xl">
          <Reveal className="grid gap-3 lg:grid-cols-[1fr_1.25fr]">
            <div className="flex flex-col rounded-card bg-surface p-6 sm:p-8">
              <SectionLabel index="08">For platforms</SectionLabel>
              <h2 className="mt-6 text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.12] font-normal">
                Put verified promises inside your marketplace. <span className="text-faint">REST, SDK, signed webhooks and MCP.</span>
              </h2>
              <ul className="mt-8 space-y-3 text-[15px] text-ink-2">
                {["Create, fund and track promises with one API key", "Signed webhooks for every state change", "Receipts your users can verify without trusting you", "Scoped tokens and an MCP server for AI agents"].map((x) => (
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
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="ml-2 font-mono">checkout.ts</span>
              </div>
              <pre className="overflow-x-auto p-5 font-mono">
                <code>
                  <span className="text-[#f9a8d4]">import</span> {"{ Kept }"} <span className="text-[#f9a8d4]">from</span> <span className="text-[#a7f3d0]">&quot;@kept/sdk&quot;</span>;{"\n\n"}
                  <span className="text-[#f9a8d4]">const</span> kept = <span className="text-[#f9a8d4]">new</span> <span className="text-[#7dd3fc]">Kept</span>({"{"} baseUrl, apiKey: process.env.KEPT_API_KEY {"}"});{"\n\n"}
                  <span className="text-white/40">{"// Plain English in, proved contract out"}</span>
                  {"\n"}
                  <span className="text-[#f9a8d4]">const</span> {"{ contractId, inviteUrl }"} = <span className="text-[#f9a8d4]">await</span> kept.contracts.<span className="text-[#93c5fd]">create</span>({"{"}
                  {"\n"}  role: <span className="text-[#a7f3d0]">&quot;funder&quot;</span>,{"\n"}  prompt: <span className="text-[#a7f3d0]">&quot;$100 now, $200 when the final SVG logo is delivered&quot;</span>,{"\n"}  counterpartyEmail: <span className="text-[#a7f3d0]">&quot;designer@example.com&quot;</span>,{"\n"}  compile: <span className="text-[#7dd3fc]">true</span>,{"\n"}
                  {"}"});{"\n\n"}
                  <span className="text-white/40">{"// Send the payer to PayPal; Kept holds the money"}</span>
                  {"\n"}
                  <span className="text-[#f9a8d4]">const</span> {"{ approveUrl }"} = <span className="text-[#f9a8d4]">await</span> kept.contracts.<span className="text-[#93c5fd]">fund</span>(contractId);{"\n\n"}
                  <span className="text-white/40">{"// Every state change arrives as a signed webhook"}</span>
                  {"\n"}
                  <span className="text-[#f9a8d4]">const</span> event = <span className="text-[#93c5fd]">verifyWebhook</span>({"{"} secret, headers, body {"}"});
                </code>
              </pre>
            </div>
          </Reveal>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-5 pb-24 sm:pb-32">
        <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1fr_1.6fr]">
          <Reveal>
            <SectionLabel index="09">Questions</SectionLabel>
            <h2 className="mt-6 text-[clamp(1.75rem,3vw,2.5rem)] font-normal leading-[1.12]">Asked before anyone pays.</h2>
            <p className="mt-4 flex items-center gap-2 text-sm text-muted">
              <Clock3 className="size-4" /> Something else? Read the <Link href="/docs" className="text-pp hover:text-pp-deep">docs</Link>.
            </p>
          </Reveal>
          <Reveal delay={80}>
            <div className="divide-y divide-line-2 border-y border-line-2">
              {FAQ.map((f) => (
                <details key={f.q} className="group py-1">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 text-[17px] tracking-[-0.03em] [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <Plus className="size-4 shrink-0 text-muted transition-transform duration-300 group-open:rotate-45" />
                  </summary>
                  <p className="max-w-2xl pb-5 text-[15px] leading-relaxed text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Closing */}
      <section className="px-5 pb-24 sm:pb-32">
        <Reveal className="mx-auto max-w-6xl">
          <div className="relative overflow-hidden rounded-card bg-ink px-6 py-16 text-white sm:px-12 sm:py-20">
            <img src={photo(PHOTOS.womanBench, 1800)} alt="" className="absolute inset-0 size-full object-cover opacity-35" />
            <div className="absolute inset-0 bg-gradient-to-r from-black via-black/70 to-transparent" />
            <div className="relative max-w-xl">
              <h2 className="text-[clamp(2rem,4.5vw,3.5rem)] font-medium leading-[1.02] tracking-[-0.05em]">
                Every promise, kept. <span className="text-white/45">Starting with yours.</span>
              </h2>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button href="/signin?mode=signUp" variant="inverse" size="lg">
                  Make a promise
                </Button>
                <Button href="/docs" variant="inverse-ghost" size="lg">
                  Read the docs
                </Button>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      <SiteFooter />
    </>
  );
}
