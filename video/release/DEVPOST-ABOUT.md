## Inspiration

You paid the deposit; the designer replied with a read receipt. Or flip it: you delivered the logo, and the client vanished. **The payment worked. The promise didn't.**

Payments today are instant and final, but the promise behind them lives in a chat thread. And AI agents are about to spend real money for us, with a card number and nothing that says *what* they're allowed to buy. We wanted money that only moves when the promise behind it is kept, with proof, not trust.

## What it does

You describe a deal the way you'd text it:

> *"Pay the designer $300. $100 now, $200 when the logo lands. Refund me if nothing shows in a week."*

- **Say it.** Claude turns the words into **promises** (what each side is owed) and **rules** (when money moves). Typing something shady, like a "release fee to unlock your money", gets flagged before anyone pays.
- **Prove it.** Before a cent moves, a verifier walks **every possible order** of deliveries, deadlines and reviews: 63 possible futures for a plumber visit, checked in 2 ms. It proves money is conserved in every reachable state,
  $$\text{money in} = \text{released} + \text{refunded} + \text{still held},$$
  that nothing gets stuck, and that every promise holds. On the first draft of the logo deal it found a real bug: *deliver on time, and the designer still loses $200.* Claude repairs the **rules**, never your promises, and the verifier proves the repair: 6 properties across 9 reachable states.
- **Hold it.** Both sides approve the exact same terms by an 8-character fingerprint. The payer puts the money on hold with **PayPal**: a real authorization, not a balance in our account. Not held by a stranger. Not held by us.
- **Keep it.** An accepted delivery releases money by **partial capture** and **PayPal Payouts**. A missed deadline **voids** the rest of the hold. Kept's 2.5% fee is taken only from money that's actually released (on a $300 deal, $7.50).
- **Try to cheat.** Every step is a signed, hash-chained receipt. Change $200 to $2,000 in the money trail (an AG Grid you can edit) and verification fails in your browser, even if you recompute the hash.
- **Agents.** Give an AI agent a **budget, not your card**: a total, a per-purchase cap, approval above a threshold, a merchant allowlist and an expiry, all enforced by code over REST and MCP. Paper? Paid. Toner? It asks you first. A $60 chair? Denied. A stolen token? Not today. A backtest replays real purchases against stricter rules before you change them, and closing the budget returns every unused dollar.

## How we built it

- **PayPal:** Orders v2 (authorize intent and buyer approval), Payments v2 (partial captures, just-in-time reauthorization after the 3-day honor period, voids, refunds), Payouts v1, and Webhooks v1 with signature verification. Every money-moving call carries a `PayPal-Request-Id`, so a retry after a timeout can never move money twice.
- **Claude (Anthropic):** writes promises and rules from plain English, repairs rules from the verifier's counterexamples, examines delivered work, and screens agent purchases. **None of these jobs can move money by itself.** Proofs, both parties and PayPal decide.
- **Verifier:** a small typed contract language and an exhaustive model checker in TypeScript. It runs on the server and in your browser.
- **Backend:** Convex (auth, contract engine, outbox, scheduler, REST API, remote MCP server). **Web:** Next.js and React, with AG Grid for the money trail and the policy backtest.

## Challenges we ran into

We couldn't sign in to the PayPal Developer Dashboard before the deadline, so we had no sandbox keys. Rather than leave the PayPal path untested, we tested it against **PayPal's own published OpenAPI specifications** (Orders, Payments, Payouts, Webhooks).

A stand-in PayPal validates every request Kept sends, and every response it gives back, against those specs. It also enforces PayPal's money rules: approval before authorization, capture limits, one use per invoice number, duplicate payout batches, unclaimed payouts, and timeouts after money already moved. Kept's full flows pass with **zero spec violations**, and that work found and fixed real issues before any judge could hit them. The demo video runs on Kept's built-in PayPal simulator and says so on screen.

**With your own sandbox keys it runs for real.** `npm run paypal:check` confirms your keys, Orders, Payouts and return URL in seconds, and prints the fix for anything that's wrong. The guide is in [JUDGES.md](https://github.com/willburhachita/kept/blob/main/JUDGES.md).

## Accomplishments that we're proud of

- **Proofs, not promises:** a deal can't go live until every possible future has been checked.
- **The AI can't move money.** It proposes, and math, people and PayPal decide.
- **A receipt trail nobody can rewrite**, not even us, checkable in any browser with no account.
- 79 automated tests, including the full PayPal lifecycle against PayPal's published specs.

## What we learned

Most payment disputes aren't fraud. They're two people remembering a deal differently. Writing the deal down precisely, and proving the money can only follow it, removes most of the argument before it starts. We also learned to test against the contract PayPal publishes, not against our own assumptions.

## What's next for Kept

A live sandbox run with real keys, then PayPal's multiparty flows for production so funds stay in PayPal's custody end to end, more templates (rent deposits, supplier orders, tutoring), and agent budgets on more storefronts.

**Try it yourself:**

- Code: [github.com/willburhachita/kept](https://github.com/willburhachita/kept) (MIT)
- Run it with your PayPal sandbox in about 10 minutes: [JUDGES.md](https://github.com/willburhachita/kept/blob/main/JUDGES.md)
- How the PayPal integration was verified: [docs/12-PAYPAL-VERIFICATION.md](https://github.com/willburhachita/kept/blob/main/docs/12-PAYPAL-VERIFICATION.md)
