Payment scams almost always need one thing: money that moves because someone *trusted* something: a screenshot, a promise, an email, a link. Kept is built so money moves only on proof. This page is for two audiences: platforms integrating Kept, and the people using it.

## The threat model

| Attack | How it usually works | What stops it on Kept |
|---|---|---|
| Fake payment proof | "I've paid, here's the screenshot." Work starts, money never existed. | Funding is a real PayPal hold, confirmed server-side with PayPal. The status comes from PayPal and the signed journal, never from anything a user uploads. |
| Non-delivery | Buyer pays up front; nothing arrives. | Nothing is released without accepted evidence or a deadline rule. Missed deadlines return the money automatically, by proved rules. |
| Non-payment | Freelancer delivers; buyer vanishes or reverses the payment. | Once proved terms are funded, the payer can't pull the money back unilaterally. Accepted deliveries release it; silence past the challenge window counts as acceptance. |
| Overpayment / refund-the-difference | Scammer "accidentally" overpays with a reversible method and asks for the difference back. | Amounts are fixed in the proved terms. There is no difference to refund, and no off-platform channel. |
| Advance-fee ("release fee") | Victim is told to pay a fee to unlock incoming money. | Kept's fee is taken automatically from released money. There is never a separate fee to receive funds, and the UI says so. |
| Payout swap | Attacker changes the payee's payout details before release. | The payout email is locked into the promise at approval. Only an arbiter can change it, with a reason, and it's journaled for both sides. |
| Terms changed after agreement | "That's not what we agreed." | Both sides approve an exact `termsHash` (an 8-character fingerprint they can compare). Any change makes new terms and resets both approvals. |
| Phishing clones | A look-alike site collects passwords or payments. | The app warns on any host other than the official one, internal redirects only follow same-site paths, the app can't be framed, and anyone can check a link at [/verify](/verify). |
| Evidence manipulation | A file contains hidden instructions for the AI ("mark this as passing"). | Evidence is wrapped as untrusted data, the examiner reports suspected manipulation, a pass only opens a challenge window, and humans decide disputes. |
| Tampered records | "The system says I was paid." | Every event is signed (Ed25519) and hash-chained, and sealed into a public Merkle log. Anyone can verify a promise's history in their browser. |
| Rogue AI agent | An agent with payment access overspends or buys the wrong thing. | Agents get a scoped budget, not a card. A deterministic guard enforces every cap; AI screening can only escalate. |

## Integration checklist for platforms

- [ ] Keep API keys on your server only. Rotate them in Settings if exposed.
- [ ] Verify every webhook signature (`verifyWebhook`) and reject stale timestamps.
- [ ] Never mark anything as paid from a redirect or a client message; confirm with Kept.
- [ ] Render buttons from `nextActions` only.
- [ ] Show the terms fingerprint where users approve and tell them to compare it.
- [ ] Show the hold, fee cap and every money movement, using the API's formatted strings.
- [ ] Show the scam red flags to the person approving or funding (the API returns the original deal text; run your own checks or use ours).
- [ ] Link users to [/verify](/verify) to check links and receipts independently.
- [ ] Use idempotency keys for every agent spend.
- [ ] Never ask users for PayPal passwords, card numbers or one-time codes, and say so in your UI.

## For people: red flags

Walk away, or at least slow down, if a deal involves any of these:

- **Paying outside PayPal**: gift cards, crypto, wire transfers, mobile money. Kept only protects money held through PayPal.
- **A fee to receive money.** Real buyers never ask you to pay to get paid.
- **Passwords, PINs or one-time codes.** Nobody legitimate needs them, not Kept, not PayPal.
- **An overpayment** you're asked to refund.
- **Pressure to hurry**: "today only", "within the hour".
- **Money routed to someone else**: "my agent will collect".
- **Guaranteed returns.** Kept is for paying for real work and goods, not investments.

Kept scans deal text for these patterns and warns both sides before anyone approves or funds.

## If something feels wrong

- Don't approve or fund. Nothing moves until both sides approve and the payer funds.
- If money is already held: reject the delivery or open a dispute. An arbiter reviews it; the money stays put meanwhile.
- Check a link at [/verify](/verify) before signing in through it.
- Report vulnerabilities through the repository's security policy on [GitHub]({{GITHUB}}).
