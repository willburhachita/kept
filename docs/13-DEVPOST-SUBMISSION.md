# Devpost submission text

Paste-ready text for the Devpost form, section by section.

## Tagline

Payments that keep their word: Claude writes the deal, a verifier proves it, PayPal holds the money, and it moves only when the promise is kept.

## Inspiration

Everyone who has paid a deposit to a stranger knows the feeling: the payment worked, but the promise didn't. Freelancers know the other side: the work is delivered and the client vanishes. And now AI agents are about to spend real money for us, with nothing stopping them from spending it the way we didn't mean.

## What it does

You describe a deal the way you'd text it: *"Pay the designer $300. $100 now, $200 when the logo lands. Refund me if nothing shows in a week."*

- **Say it.** Claude turns the words into promises (what each side is owed) and rules (when money moves), and flags scams like "pay a release fee to unlock your money".
- **Prove it.** A verifier walks every possible order of deliveries, deadlines and reviews (63 possible futures for a plumber visit, in 2 ms). It proves money is conserved, nothing gets stuck, and every promise holds. When it finds a counterexample, Claude repairs the rules, never the promises.
- **Hold it.** Both sides approve the exact same terms by fingerprint. The payer puts the money on hold with PayPal: a real authorization, not a balance in our account.
- **Keep it.** Accepted deliveries release money by partial capture and Payouts. Missed deadlines void the rest. Kept's 2.5% fee is taken only on money that's actually released.
- **Try to cheat.** Every step is a signed, hash-chained receipt. Change $200 to $2,000 in the money trail and it fails verification in your browser, even if you recompute the hash.
- **Agents.** Give an AI agent a budget, not your card: caps, approvals above a threshold, a merchant allowlist and expiry, all enforced by code, over REST and MCP. A backtest replays real purchases against stricter rules.

## How we built it

- **PayPal:** Orders v2 (authorize intent, buyer approval), Payments v2 (partial captures, just-in-time reauthorization after the honor period, voids, refunds), Payouts v1, and Webhooks v1 with signature verification. Every money-moving call carries a `PayPal-Request-Id`, so retries never move money twice.
- **AI:** Claude writes the promises and rules, repairs rules from verifier counterexamples, examines delivered evidence, and screens agent purchases. None of these jobs can move money by itself.
- **Verifier:** a small typed contract language with an exhaustive model checker, written in TypeScript; it also runs in the browser.
- **Backend:** Convex (auth, engine, outbox, scheduler, REST API, remote MCP). **Web:** Next.js, plus AG Grid for the tamper-evident money trail and policy backtests.

## Challenges

We couldn't sign in to the PayPal Developer Dashboard before the deadline, so we had no sandbox keys. Rather than leave the PayPal path untested, we tested it against **PayPal's own published OpenAPI specifications**. A stand-in PayPal validates every request Kept sends, and every response it returns, against those specs, and enforces PayPal's money rules: approval before authorization, capture limits, duplicate invoice numbers, payout duplicates, unclaimed payouts, and timeouts after money moved. Kept's full flows pass with zero violations. This found and fixed real issues before any judge could hit them. The demo video runs on Kept's built-in PayPal simulator and says so on screen.

**To run it on your own sandbox:** follow `JUDGES.md` (about 10 minutes). `npm run paypal:check` confirms your keys, Orders, Payouts and return URL in seconds, and prints the fix for anything wrong.

## Accomplishments

- Proofs, not promises: a deal can't go live until the verifier has checked every possible future.
- The AI can't move money. It proposes; proofs, both parties and PayPal decide.
- A receipt trail nobody can rewrite, not even us, checkable in the browser with no account.

## What's next

A real sandbox run with the judges' keys, then PayPal's multiparty flows for production so funds stay in PayPal's custody, and agent budgets on more storefronts.

## Built with

PayPal Orders v2 · PayPal Payments v2 · PayPal Payouts · PayPal Webhooks · Claude (Anthropic) · Convex · Next.js · TypeScript · AG Grid · Channel3 · MCP

## AI tools used and how

- **Claude (`claude-opus-5-5`, Anthropic API):** drafting promises and rules from plain English, repairing rules from verifier counterexamples, examining delivered evidence, and screening agent purchases.
- **Claude Code:** used to build the project.
