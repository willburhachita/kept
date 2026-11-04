## Promise

A promise is what one side is guaranteed: *"the designer receives at least $300 whenever the final logo was submitted before the deadline and hasn't been rejected."* Promises are what people sign, so they're written to be read. Claude may never change a promise to make the rules pass; it can only repair the rules.

## Rule

A rule says when money moves: *"when the final logo is accepted, if it was submitted before the deadline, release everything still held to the payee."* Rules are triggered by events (the contract starting, a delivery being accepted or rejected, a deadline passing) and guarded by conditions.

## Proof

Before anyone can fund a promise, the verifier explores **every reachable state**: every order in which deliveries, reviews and deadlines can happen, including ties. It checks that:

| Property | Meaning |
|---|---|
| Every cent is accounted for | Money in equals money out; no rule pays more than is held |
| No money gets stuck | Every possible ending releases or refunds every cent |
| Each promise holds | On every ending it covers |
| Fits PayPal's lifecycle | Every capture and refund happens inside PayPal's time limits |
| No review is cut off | Nothing settles while the payee waits on a review (a warning) |

If a property fails, you get the **shortest** sequence of events that breaks it, narrated step by step with the money at each step.

## Hold

The payer's money sits on PayPal for the whole promise. In *authorize* mode it's an authorization on the payer's account (PayPal holds it; nothing is taken until a rule releases it). In *escrow* mode it's captured up front and refunded as rules return it. The hold includes the most the fee could ever be.

## Delivery (evidence)

Each deliverable has criteria agreed in the terms, such as "is a vector SVG" or "contains the brand name". A delivery can be a file, text or a link. Files are fingerprinted with SHA-256.

## AI examiner

Claude checks each delivery against its criteria and reports per-criterion confidence and any sign of manipulation (for example, instructions hidden in a file aimed at the AI). It can only:

- pass a delivery into the **challenge window**, where the payer can still object, or
- hand it to the payer to review.

It can never release money on its own.

## Windows and deadlines

| Window | Who acts | What happens if nobody does |
|---|---|---|
| Challenge window | Payer can object to an AI pass | The delivery counts as accepted |
| Payer review | Payer accepts or rejects | Escalates to an arbiter |
| Dispute window | Payee can dispute a rejection | The rejection stands |
| Arbitration | A neutral arbiter decides | Flagged as overdue to staff |

## Arbiter

A neutral human who decides disputes, resumes frozen promises, and is the only person who can change a payee's payout email. Every arbiter action needs a written reason and is signed into the journal.

## Receipts

Every event is a journal entry: canonical JSON, hashed with SHA-256, linked to the previous entry's hash, and signed with Ed25519. Entries are batched into signed Merkle checkpoints. See [Receipts & transparency](/docs/receipts).

## Agent budget (mandate)

A budget an AI agent can spend inside a verified policy: total, per purchase, number of purchases, purchases per hour, allowed merchants, an approval threshold and an expiry. See [AI agents & MCP](/docs/mcp).
