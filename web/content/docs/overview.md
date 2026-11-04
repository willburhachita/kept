Kept is a payment layer for deals where one side does something and the other side pays for it: a logo, a plumbing job, a crate of stock, a purchase made by an AI agent. The money is held by PayPal from the start, and it moves only by rules that both sides approved and that a verifier has **proved** can't break the promises they made.

## The problem it solves

Most payment fraud and most payment disputes live in the same gap: the time between doing the work and getting paid for it. Whoever moves first carries all the risk. Pay up front and the work may never arrive. Deliver first and the money may never come. Into that gap step fake payment screenshots, "send the difference back" overpayment tricks, and endless arguments about what was agreed.

Escrow closes the gap, but classic escrow has two weaknesses: the release rules are vague ("when the buyer is satisfied"), and someone has to be trusted to apply them. Kept fixes both.

## How it works

1. **Say it.** Either side describes the deal in plain English. Claude turns it into *promises* (what each side is owed, and when) and *rules* (when money moves).
2. **Prove it.** An exhaustive model checker explores every order in which deliveries, reviews and deadlines can happen, including two things happening at the same instant. If any order breaks a promise, it shows the exact sequence and Claude repairs the rules (never the promises).
3. **Approve it.** Both sides approve the exact proved terms, identified by an 8-character fingerprint they can read to each other.
4. **Hold it.** The payer approves a PayPal hold. The money stays on PayPal the whole time.
5. **Keep it.** Accepted deliveries release their share; missed deadlines return the rest. An AI examiner checks deliveries against the agreed criteria, but it can only pass something into a challenge window or hand it to a human. Disputes go to a neutral arbiter.

Every event (approvals, holds, captures, payouts, decisions) is signed with Ed25519 and hash-chained, and sealed into a public Merkle log, so anyone can verify the history without trusting Kept.

## What's in the box

| Piece | What it is |
|---|---|
| Web app | This site: make, fund and track promises; agent budgets; developer settings |
| REST API | `{{API}}/v1`, authenticated with API keys |
| `@kept/sdk` | A typed JavaScript client, plus webhook and receipt verification |
| `@kept/core` | The contract language, verifier, fee math and crypto, usable offline |
| `@kept/mcp` | An MCP server so AI assistants can verify contracts and spend inside a budget |
| Webhooks | Signed notifications for every state change |

## Where to go next

- [Quickstart](/docs/quickstart): a settled promise on the sandbox in ten minutes.
- [Embed Kept in your platform](/docs/embedding): the integration pattern for marketplaces.
- [Scam protection](/docs/scam-protection): what stops each kind of attack.
