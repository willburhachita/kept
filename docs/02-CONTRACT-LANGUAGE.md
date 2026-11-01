# The contract language (IR v1)

Small on purpose: no loops, and no arithmetic beyond fixed amounts and "everything still held". That makes exhaustive verification possible. Source: `packages/core/src/ir.ts`, semantics: `interpreter.ts`.

```jsonc
{
  "irVersion": 1,
  "title": "Logo design, milestone payment",
  "summary": "…",
  "currency": "USD",                 // USD EUR GBP CAD AUD
  "principalCents": 30000,           // $300.00 at stake (100..1,000,000)
  "fundingMode": "authorize",        // authorize (hold on funder's PayPal) | escrow (capture up front)
  "challengeWindowHours": 24,        // 1..168
  "deadlines": [{ "id": "delivery", "label": "Delivery deadline", "afterHours": 168 }],
  "evidence": [{ "id": "final_svg", "label": "Final logo (SVG)", "kind": "file",
                 "criteria": ["Is a vector SVG file", "Contains the brand name 'Acme'"], "autoAcceptConfidence": 0.85 }],
  "guarantees": [   // the PROMISES people approve; the verifier proves the rules keep them
    { "id": "designer_paid", "label": "Designer gets $300 for on-time delivery", "party": "payee", "atLeastCents": 30000,
      "when": [ { "kind": "submitted_before", "evidence": "final_svg", "deadline": "delivery", "negate": false },
                { "kind": "rejected", "evidence": "final_svg", "deadline": null, "negate": true } ] }
  ],
  "clauses": [      // the RULES
    { "id": "kickoff", "label": "Upfront payment",
      "trigger": { "on": "activated", "evidence": null, "deadline": null }, "guard": [],
      "actions": [{ "op": "release", "cents": 10000, "remaining": false }] }
  ]
}
```

## Semantics (exact)

- **Activation**: funding confirmed; the principal is held. Deadlines are counted from here and fire in `afterHours` order.
- **Evidence**: each slot can be submitted once. Submissions are allowed until the **last** deadline passes. After submission a review ends in `accepted` or `rejected`, possibly long after later deadlines.
- **Literals**: `submitted(E)`, `submitted_before(E, D)` (submitted while D had not passed), `accepted(E)`, `rejected(E)`, `deadline_passed(D)`, each optionally negated. A guard is an AND of literals.
- **Clauses**: when the trigger happens (`activated`, `accepted(E)`, `rejected(E)`, `deadline(D)`), every matching clause whose guard holds fires **once ever**, in declaration order.
- **Actions**: `release` pays the payee, `refund` returns money to the funder, each for a fixed number of cents or `remaining`. A fixed amount above what is held is a fault: the verifier reports it, and the runtime would freeze.
- **Closing**: when nothing is held the contract closes; later events cannot happen.
- **Consent exits** (outside the proof by design): the funder may always release everything; the payee may always hand everything back.

## Patterns that pass the verifier

| Situation | Write | Not |
|---|---|---|
| On-time payment | `on accepted(E) if submitted_before(E, D)` | "accepted before D" (reviews can finish after D) |
| No-show refund | `on deadline(D) if not submitted(E)` | `if not accepted(E)` (races an honest review) |
| Rejection | `on rejected(E) → refund what E was worth` | nothing (money gets stuck) |
| Payment needs two reviews | a **join pair**: on accepted(A) if accepted(B), and on accepted(B) if accepted(A) | a single rule (the order of reviews is not fixed) |

## Hashes and approvals

- `irHash = sha256(canonicalJson(ir))` (sorted keys, no whitespace).
- `termsHash = sha256(canonicalJson({v:1, irHash, funderId, payeeId, feeBps, engineVersion}))`. This is what both parties approve, and it is re-checked at funding.

## Mandates (agent spending policy)

```jsonc
{ "version": 1, "title": "Office supplies agent", "purpose": "Restock office supplies…", "currency": "USD",
  "budgetCents": 20000, "perPurchaseMaxCents": 5000, "maxPurchases": 10, "expiresAfterHours": 168,
  "allowedMerchants": ["@supplies.example.com", "orders@coffee.example.com"], "approvalAboveCents": 3000, "maxPerHour": 5 }
```
