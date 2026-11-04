Claude writes promises in a small typed language, and the verifier proves them. It's small on purpose: no loops and no arithmetic beyond fixed amounts and "everything still held", which is what makes exhaustive verification possible. You can also write contracts by hand and pass them as `ir`.

## Shape

```json
{
  "irVersion": 1,
  "title": "Logo design, milestone payment",
  "summary": "Pay a designer $300: $100 up front, $200 on delivery.",
  "currency": "USD",
  "principalCents": 30000,
  "fundingMode": "authorize",
  "challengeWindowHours": 24,
  "deadlines": [{ "id": "delivery", "label": "Delivery deadline", "afterHours": 168 }],
  "evidence": [{
    "id": "final_svg", "label": "Final logo (SVG)", "kind": "file",
    "criteria": ["Is a vector SVG file", "Contains the brand name 'Acme'"],
    "autoAcceptConfidence": 0.85
  }],
  "guarantees": [{
    "id": "designer_paid", "label": "Designer gets $300 for on-time delivery",
    "party": "payee", "atLeastCents": 30000,
    "when": [
      { "kind": "submitted_before", "evidence": "final_svg", "deadline": "delivery", "negate": false },
      { "kind": "rejected", "evidence": "final_svg", "deadline": null, "negate": true }
    ]
  }],
  "clauses": [{
    "id": "kickoff", "label": "Upfront payment",
    "trigger": { "on": "activated", "evidence": null, "deadline": null },
    "guard": [],
    "actions": [{ "op": "release", "cents": 10000, "remaining": false }]
  }]
}
```

| Field | Values |
|---|---|
| `currency` | USD, EUR, GBP, CAD, AUD |
| `principalCents` | 100 to 1,000,000 |
| `fundingMode` | `authorize` (a hold on the payer's PayPal) or `escrow` (captured up front) |
| `challengeWindowHours` | 1 to 168 |
| `evidence[].kind` | `file`, `text`, `link` |

## Semantics

- **Activation**: funding confirmed; the principal is held. Deadlines count from here.
- **Deliveries**: each slot can be submitted once, until the last deadline passes. Reviews end in `accepted` or `rejected`, possibly after later deadlines.
- **Literals**: `submitted(E)`, `submitted_before(E, D)`, `accepted(E)`, `rejected(E)`, `deadline_passed(D)`, each optionally negated. A guard is an AND of literals.
- **Promise premises** (`guarantees[].when`) can't use `deadline_passed`, because a contract can close before the deadline passes. Write "nothing arrived by the deadline" as NOT `submitted_before(E, D)`.
- **Clauses**: when a trigger happens (`activated`, `accepted(E)`, `rejected(E)`, `deadline(D)`), every matching clause whose guard holds fires once, in order.
- **Actions**: `release` pays the payee, `refund` returns money to the payer, a fixed number of cents or `remaining`.
- **Closing**: when nothing is held, the contract closes.
- **Consent exits**: the payer may always release everything; the payee may always give everything back.

## Patterns that pass

| Situation | Write | Not |
|---|---|---|
| On-time payment | on `accepted(E)` if `submitted_before(E, D)` | "accepted before D" (reviews can finish after D) |
| No-show refund | on `deadline(D)` if not `submitted(E)` | if not `accepted(E)` (races an honest review) |
| Rejection | on `rejected(E)`: refund what E was worth | nothing (money gets stuck) |
| Needs two approvals | a pair: on `accepted(A)` if `accepted(B)`, and the reverse | one rule (review order isn't fixed) |

## Hashes

- `irHash = sha256(canonicalJson(ir))`
- `termsHash = sha256(canonicalJson({ v: 1, irHash, funderId, payeeId, feeBps, engineVersion }))`. This is what both sides approve; the first 8 characters are the fingerprint.

Try it now in the [proof playground](/verify).
