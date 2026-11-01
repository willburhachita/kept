# Kept: start here

> **Every promise, kept.** Payments that only move when the promise behind them is kept, with a mathematical proof that nobody can be cheated, running on real PayPal rails.

## Explain it like I'm five

You want your friend to draw you a picture, and you'll give them 3 candies.
You don't want to hand over the candies before the picture exists. Your friend doesn't want to draw unless the candies are real.

So you both give the candies to a **robot teacher** who keeps them in a locked jar.

1. You tell the teacher the deal in normal words: *"1 candy now, 2 candies when the picture is done by Friday. If there's no picture, I get my 2 back."*
2. The teacher writes the rules down very carefully. Then, before anyone starts, the teacher plays **every possible "what if" game**:
   - What if the picture comes on Friday at the very last second?
   - What if the teacher is still looking at it when Friday ends?
   - What if it's the wrong picture?

   If any of those games ends with someone cheated, or with candy stuck in the jar forever, the teacher finds the hole and fixes the rules *before anyone plays for real*.
3. When your friend brings the picture, a helper with sharp eyes checks it matches what you asked for. You still get a moment to say "wait, that's wrong", and if you two disagree, a grown-up decides.
4. Then the jar opens and the candies go where the rules say.
5. Everything is written in a notebook where each page is glued to the one before it, so **nobody can secretly tear a page out**, not even the teacher.

That's Kept. The candies are real money on PayPal. The robot teacher is a model checker. The careful note-taker is Claude. The sharp-eyed helper is Claude looking at the deliverable. The glued notebook is a signed hash chain.

## What it really is (one paragraph)

Kept compiles a plain-English money agreement into a tiny, decidable contract language. It **exhaustively verifies** every possible ordering of deliveries, reviews and deadlines (money is conserved, nothing gets stuck, every promise holds, PayPal's authorization timing fits). It then executes the contract on the PayPal sandbox with authorizations, partial captures, just-in-time reauthorization, voids, partial refunds, Payouts and webhooks. Claude does three jobs: it writes the promises and the rules, it repairs the rules from counterexamples, and it examines evidence. None of those jobs lets it move money by itself. The same engine gives AI shopping agents **mandates** instead of credit cards.

## Why this is not another hackathon idea

| What 20,000 people build | What Kept does instead |
|---|---|
| "AI shopping assistant" plus a checkout button | AI writes a contract, **a math engine proves it**, PayPal executes it |
| A chatbot that creates invoices | The **whole PayPal payments lifecycle**: authorize, partial capture, reauthorize, void, refund, payout, webhooks |
| "Trust the AI" | **The AI cannot move money.** It proposes; proofs, humans and challenge windows decide |
| Agents with a card number | Agents with a **mandate**: budget, caps, merchant allowlist, expiry, approvals, all enforced by pure code |
| A database of payments | A **signed, hash-chained journal** sealed into Merkle checkpoints that anyone can verify offline |

### The killer demo moment

You type: *"$100 now, $200 when she delivers the final logo, refund me if nothing arrives in 7 days."*

The first draft of the rules (exactly what a person or a model writes first) says "at the deadline, refund if the logo wasn't accepted". The verifier answers in under a millisecond with a 3-step counterexample:

1. The contract starts and $100 goes to the designer.
2. The designer delivers on time.
3. The 7-day deadline passes **while the review is still running**, so the $200 is refunded.

*The designer delivered on time and got $100 of the promised $300.*

Claude repairs the rule to "refund only if nothing was **submitted**". The proof turns green, and a real PayPal sandbox capture lands. We even caught a bug like this in **our own** hand-written plumber example (see `plumberDraft` in `@kept/core`).

## How it makes money

1. **Take rate on kept promises.** 2.5% (configurable `FEE_BPS`) of money actually **released**. Refunds are free, so the business earns only when promises are kept. The funder authorizes principal plus maximum fee up front; unused fee is released automatically.
2. **Platform API.** Marketplaces, freelance sites and booking apps embed verified contracts via the REST API or SDK (`@kept/sdk`), priced per verified contract plus the take rate. The core engine is open source (`@kept/core`), which drives adoption; the hosted rails, receipts and arbitration are the paid product.
3. **Agent mandates.** Every AI agent that buys things needs a safe way to pay. Mandates are billed per mandate or per spend. This lines up with PayPal's agentic-commerce push.
4. **Arbitration and compliance.** Paid human arbitration, signed proof packs for audits and disputes, and transparency checkpoints for regulated customers.

Markets it fits on day one: freelancers and agencies (milestones), home services (call-out fees, no-show refunds), event deposits, and creator collaborations. Agentic commerce is the long-term market.

## The name

Placeholder brand: **Kept**. To rebrand everything, run `node scripts/rename.mjs <NewName>`.

Shortlist we considered: Kept, Proviso, Troth, Bonded, Treaty, Upheld, Vow, Earmark, Shook, Cachet.
Domain notes: most `kept.*` domains are registered (kept.com, kept.ai, kept.money, kept.dev, getkept.com, usekept.com). Check `kept.so`, `kept.co` and `kept.io` at a registrar. No existing "Kept" was found in payments; there are unrelated companies called Kept (a Russian audit firm, and an AI chat-archive tool).

## How judges' criteria map to the code

| Criterion | Where it lives |
|---|---|
| Technological implementation | `packages/core` (verifier, interpreter, Merkle log), `backend/convex/engine.ts`, `effects.ts`, `rails/paypal.ts` |
| Design | One flow: describe, live proof timeline, approve, fund, deliver, get paid (see `09-UI-BLUEPRINT.md`) |
| Potential impact | Freelance and home-service escrow plus agent spending; global users via PayPal |
| Quality of idea | A solver-grade proof on real payment rails; AI that is checked, not trusted |
| Presentation | The counterexample moment (`11-DEMO-SCRIPT.md`) |

## Read next

- [01-ARCHITECTURE.md](01-ARCHITECTURE.md): how the pieces fit
- [08-BACKEND-API.md](08-BACKEND-API.md): every function the UI calls
- [09-UI-BLUEPRINT.md](09-UI-BLUEPRINT.md): screen templates
- [10-SETUP-AND-DEPLOY.md](10-SETUP-AND-DEPLOY.md): run it
