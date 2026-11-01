# UI blueprint (templates for building the frontend)

This UI should not feel like a pile of create/edit forms. The backend streams a **live proof**, a **money machine** and a **tamper-proof timeline**, so the UI's job is to make those visible. Every screen below lists the exact backend calls it uses (see `08-BACKEND-API.md`). All queries are reactive, so screens animate on their own.

## Pick a visual direction

| Template | Feel | Best for |
|---|---|---|
| **A. "Notary"** | Warm paper, ink-black type, a wax-seal accent for "proved" and a red stamp for "counterexample". Serif headings, mono hashes. | Trust, freelancers and home services, the video |
| **B. "Control room"** | Dark, dense, terminal-adjacent. A live state graph, ticking timers, green/amber/red property lights. | Developers, agentic commerce, the API story |
| **C. "Calm fintech"** | White space, one accent color, big numbers, soft cards. | Consumers, mobile |

Recommendation: **A for the product screens and B for the proof drawer and agent console.** The contrast tells the story: the human side feels calm, and the machine underneath is visibly rigorous.

## Core components (build these once)

1. **ProofTimeline**: vertical stream of `compiler.latestRun.steps`. Each step pulses while running, then locks green (proved) or red (violated). A red step expands into a CounterexamplePlayer.
2. **CounterexamplePlayer**: plays `property.counterexample.steps` like a story: numbered beats (`narration[]`) along a horizontal time ruler with deadline markers, plus a money bar (held / released / refunded) that animates at each step. Ends on the outcome sentence in a red stamp.
3. **MoneyRiver**: one bar split into held, released, refunded and fees (`ledger`), with PayPal execution underneath (captured, paid out, voided, refunded). Two layers: **"what the contract decided"** above **"what PayPal confirmed"**.
4. **OutcomeMatrix**: cards for `report.outcomes` ("Final logo accepted: payee $300, funder $0"), each with a "show me how" button that plays its `example` path. Header chips from `report.bounds` ("payee gets $100-$300 · settles by hour 360 · at most 9 PayPal calls").
5. **PromiseCard**: one per guarantee (`rendered.promises[i]` + property status). These are what people sign, so make them large and plain.
6. **DeadlineRuler**: `deadlines[]` with absolute `at`, a now-marker, `passed` flags and countdowns.
7. **EvidenceTile**: file preview (`file.url`), sha256 chip, AI verdict as a criteria checklist with per-criterion confidence bars, a manipulation warning, a status pill (`statusLabel`), a countdown ring (`timer.msRemaining`), and buttons from `canAccept/canReject/canChallenge/canDispute`.
8. **ReceiptChain**: `contracts.journal` as linked blocks (`seq`, `type`, actor, short `hash`, link from `prevHash`), with a "verify in browser" button that runs `verifyChain` from `@kept/core` against `/.well-known/kept-keys.json` and turns each block green.
9. **ActionBar**: buttons driven only by `contract.nextActions`. Never compute permissions in the UI.

## Screens

### 1. Landing / sign in
Hero line "Every promise, kept.", then a 15-second autoplay of the CounterexamplePlayer on `logoNaive`, then the fix turning green. Email and password via `auth.signIn` (`flow: "signUp" | "signIn"`).

### 2. "Make a promise" (create)
```
┌──────────────────────────────────────────────────────────────┐
│  I am the  (•) funder  ( ) payee                              │
│  Describe the deal ───────────────────────────────────────── │
│  │ $100 now, $200 when she delivers the final logo as SVG…  │ │
│  Counterparty email [designer@…]           Templates ▾       │
│                                   [ Compile & prove ]  ───►  │
└──────────────────────────────────────────────────────────────┘
```
`contracts.create` then `compiler.compile`. Templates come from `EXAMPLE_PROMPTS` / `EXAMPLES` in `@kept/core` (with `contracts.setTerms` for a no-AI path).

### 3. Proof studio (the money shot)
```
┌───────────── ProofTimeline ─────────────┬────── Plain English ───────────────┐
│ ✓ Promises written (2)                   │ PROMISES                          │
│ ✓ Rules drafted (3)                      │ ▣ Designer gets $300 on time       │
│ ✗ Verifier found a problem   ▸ play      │ ▣ Client gets $200 back if late    │
│   1 Starts, $100 → designer              │ RULES                              │
│   2 Delivers before deadline             │ • When the contract starts …       │
│   3 Deadline passes → $200 refunded      │ MONEY · DEADLINES · DELIVERABLES   │
│   ⟶ designer got $100 of $300            │ Assumptions the AI made (confirm)  │
│ ✓ Repair 1: proof passed                 │                                    │
│ ● Ready for review                       │ OutcomeMatrix · bounds chips        │
└──────────────────────────────────────────┴────────────────────────────────────┘
```
Data: `compiler.latestRun`, `contracts.get` (`rendered`, `verification.report`), `verification.report`.

### 4. Agreement room (review and approve)
Both parties see the same PromiseCards, a `termsHash` fingerprint (first 8 characters), each side's approval state, and an **Approve exactly this** button (`contracts.approve` with `termsHash`). The payee is prompted for their PayPal payout email first (`users.updateProfile`). Show the invite link share card (`share_invite`).

### 5. Fund
A big number: `funding.authorizationCents` ("$307.50 hold: $300 + up to $7.50 fee, charged only as money is released"). PayPal button → `funding.start` → redirect → on return `funding.confirm`. Show the lifecycle plan (`report.lifecycle.steps`) as a 5-step "what PayPal will do" list.

### 6. Live contract
```
 MoneyRiver ███████▓▓▓▓░░░░  held $200 · released $100 · refunded $0 · fee $2.50
 DeadlineRuler  start ──●now─────────── Delivery (in 3d 4h)
 Deliverables   [EvidenceTile: Final logo (SVG) · AI ✓✓✓ 0.93 · challenge window 21:14:09]
 ActionBar      [Accept now] [Challenge…]          (funder)
                [Upload delivery] [Return funds]   (payee)
 ReceiptChain   ▸ 14 signed entries · verified ✓
```
Data: `contracts.get`, `evidence.list`, `contracts.journal`, `notifications.list`. Uploads: `evidence.generateUploadUrl` → POST file → `evidence.submit`.

### 7. Settlement certificate
A printable "certificate": final amounts, every promise with ✓, PayPal ids (captures, payouts, void), and a download of the proof pack (`contracts.proof`). Add a QR code to `/v1/transparency/proof/{lastEntryHash}`.

### 8. Agent console (mandates)
```
 Office supplies agent        $135.00 left of $200 · 8 purchases left · expires in 5d
 Rules  ≤ $50/purchase · ask me above $30 · only @supplies.example.com · 5/hour
 Tokens  mt_Ab12…  "buyer bot"  last used 2m ago   [Revoke]   [+ New token] (shown once)
 Live feed  ✓ $25.00 Supplies · paper              paid
            ? $40.00 Supplies · toner     needs approval  [Approve] [Decline]
            ✗ $60.00 Supplies · chair     denied: over the per-purchase limit
 Connect an agent:  claude mcp add --transport http kept …/mcp --header "Authorization: Bearer mt_…"
```
Data: `mandates.get`, `mandates.spends`, `mandates.issueToken`, `mandates.decideSpend`, `mandates.draftFromPrompt` (a "describe your agent's budget" box).

### 9. Arbiter desk
A queue (`arbiter.queue`) with SLA countdowns, side-by-side criteria vs evidence vs AI reasoning vs both parties' statements, a decision with a required reason, and frozen contracts with a "resume" note.

### 10. Developer settings
API keys (`apiKeys.*`), webhook endpoints with the delivery log (`outbound.*`), a copy-paste SDK snippet, and the transparency checkpoint feed (`transparency.checkpoints`).

## Microcopy rules

- Say "promise", "hold", "release", "return": never "IR", "clause" or "capture" in consumer screens. (Show the technical names in the proof drawer.)
- Always show **who decides next and by when** (from timers and `nextActions`).
- Every amount shows its formatted string from the API; never re-format cents in the UI.
