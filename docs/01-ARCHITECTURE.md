# Architecture

```
                 plain English                         PayPal sandbox
                      │                                      ▲
                      ▼                                      │ Orders v2, Payments v2, Payouts v1
┌──────────────────────────────────────┐   outbox    ┌───────┴────────┐
│ compiler.ts (Claude)                 │  effects    │ rails/paypal.ts│◄── webhooks ── routes/paypal.ts
│  spec (promises) → clauses → repair  │────────────►│ rails/sim.ts   │                  webhooks.ts
└───────────────┬──────────────────────┘             └───────▲────────┘
                │ IR                                         │
                ▼                                            │ effects.ts (FIFO per stream,
┌──────────────────────────────────────┐                     │  idempotency keys, retries)
│ @kept/core                           │                     │
│  ir.ts        validate + hash        │   same code   ┌─────┴──────────────────────────┐
│  verifier.ts  exhaustive BFS proof   │◄─────────────►│ engine.ts                      │
│  interpreter  step(state, event)     │               │  applyEvent → ledger + effects │
│  render.ts    plain English          │               │  deadlines, settlement, freeze │
│  crypto.ts    hash chain, Ed25519,   │               └─────▲──────────────────────────┘
│               RFC 6962 Merkle        │                     │ submit / accept / reject
│  mandate.ts   agent spend guard      │               ┌─────┴──────────────────────────┐
└──────────────────────────────────────┘               │ evidence.ts (+ Claude examiner)│
                                                       │ challenge window, arbitration  │
  journal (lib/journal.ts): every change is hashed,    └────────────────────────────────┘
  chained, signed → transparency.ts seals Merkle
  checkpoints → anyone verifies with @kept/core        mandates.ts / agentApi.ts → routes/agent.ts, routes/mcp.ts
```

## Packages

| Package | What | Installable |
|---|---|---|
| `packages/core` (`@kept/core`) | Contract language, validator, interpreter, exhaustive verifier, renderer, fee math, Ed25519 receipts, hash chains, RFC 6962 Merkle proofs, mandate guard, JSON Schemas, examples. Pure TypeScript, runs anywhere. | `npm i @kept/core` |
| `packages/mcp` (`@kept/mcp`) | MCP server: verify, explain and prove contracts offline; check proof packs; agent spending tools; contract tools. Zero dependencies. | `npx -y @kept/mcp` |
| `packages/sdk` (`@kept/sdk`) | Typed REST and agent client, plus Standard Webhooks and receipt verification. | `npm i @kept/sdk` |
| `backend` | Convex backend: auth, engine, PayPal rails, AI pipeline, mandates, REST API, remote MCP, transparency log. | deploy with `npx convex deploy` |

## Backend modules (`backend/convex/`)

| File | Responsibility |
|---|---|
| `schema.ts` | 20 tables (auth tables plus profiles, contracts, verifications, compileRuns, evidence, effects, ledgerEntries, journal, journalHeads, checkpoints, notifications, mandates, agentTokens, spends, apiKeys, rateLimits, webhookEvents, webhookEndpoints, webhookDeliveries) |
| `auth.ts`, `auth.config.ts` | Convex Auth (email and password), profile creation, password policy |
| `contracts.ts` | create, invite, accept invite, set terms, approve by hash, cancel, view model with `nextActions`, journal, proof pack |
| `compiler.ts`, `ai/prompts.ts` | Claude pipeline with live progress (`compileRuns`) |
| `verification.ts` | runs the verifier and stores content-addressed reports |
| `funding.ts` | PayPal order, then authorize (or capture), then `engine.activate` |
| `engine.ts` | applies events with the core interpreter; ledger, outbox, deadlines, settlement, expiry guard, freeze/resume, consent exits |
| `effects.ts`, `lib/outbox.ts` | transactional outbox; executes PayPal calls in order with idempotency keys, backoff and a crash reaper |
| `rails/` | `PaymentRail` interface, PayPal REST implementation, deterministic sim rail |
| `evidence.ts`, `ai/examiner.ts`, `arbiter.ts` | submissions, AI verdicts, challenge window, funder review, disputes, arbitration |
| `mandates.ts`, `agentApi.ts`, `ai/screener.ts` | agent mandates, tokens, spend guard, AI screening that can only escalate |
| `routes/*.ts`, `http.ts` | REST v1, agent API, remote MCP, PayPal webhooks, public endpoints |
| `webhooks.ts`, `outbound.ts`, `apiKeys.ts` | inbound PayPal events, outbound developer webhooks (Standard Webhooks), API keys |
| `transparency.ts` | Merkle checkpoints and inclusion proofs |
| `lib/` | authz, errors, env, journal, ledger, notify, rate limits, secrets, validators |
| `crons.ts` | deadline sweep, evidence timers, stuck-effect reaper, expiry guard, mandate expiry, checkpoints, webhook retries |

## The life of a contract

```
draft ─compile─► compiling ─► verifying ─┬─► review ─(both approve exact termsHash)─► awaiting_funding
                                          └─► needs_attention (counterexamples shown; edit / recompile)
awaiting_funding ─fund─► funding ─(PayPal approve + confirm)─► active ─(nothing held)─► settling ─(effects done)─► settled
any pre-funding state ─► cancelled            active/settling ─(fault, PayPal dispute, failed effect)─► frozen ─(arbiter)─► resumed
```

1. **Create.** The creator picks a role (funder or payee) and gets a one-time invite link (only its SHA-256 is stored).
2. **Compile.** Claude writes the promises (spec), then the rules (clauses). The verifier checks them; Claude repairs only the rules, up to 4 rounds. Every step streams into `compileRuns`.
3. **Verify.** Server-side, content-addressed by `(irHash, feeBps, engineVersion)`. Only server code writes results.
4. **Approve.** Each party approves the **termsHash** = H(irHash, funderId, payeeId, feeBps, engineVersion). Any change resets approvals. The payee's payout email is locked at approval.
5. **Fund.** PayPal order (AUTHORIZE, or CAPTURE for escrow mode). After the buyer approves, the server authorizes or captures, re-checks the approval chain and the exact amount, then activates.
6. **Run.** Every submit, accept, reject and deadline is a machine event applied inside a serializable Convex transaction by the **same interpreter the verifier proved**. Money decisions become ledger postings plus outbox effects in the same transaction.
7. **Settle.** When nothing is held, the uncaptured authorization is voided (or unused escrow is refunded). The contract reaches `settled` once PayPal confirms every effect.

## Money model

- Principal `P`; fee `ceil(released × feeBps / 10000)`, computed on the cumulative released amount (no rounding drift); funder authorizes `A = P + maxFee`.
- **Authorize mode**: each release captures `release + fee` (a partial capture) and then pays out `release`. Refunds are earmarked and released by a final void.
- **Escrow mode** (long contracts): capture `A` up front; releases are payouts and refunds are partial refunds of the capture.
- **Expiry guard**: if an authorization would expire while money can still move, the remainder is captured into escrow 24 hours early and the runtime switches to escrow mode.
- **Ledger**: `held + released + refunded = principal` always holds. The runtime cross-checks the ledger against the proven state machine after every event and freezes on any divergence.

## Concurrency and failure

- Convex mutations are serializable, so a delivery and a deadline at the same instant apply in one order or the other. The verifier proved both orders safe.
- PayPal calls never happen inside mutations. They are written to the outbox in the same transaction and executed by an action with `PayPal-Request-Id = effect id`, so a retry never moves money twice.
- One effect in flight per stream, in order. Retryable errors back off (5 s up to 2 h, 8 attempts). Permanent errors freeze the contract for an arbiter.
- Crons restart anything a crash left behind.
