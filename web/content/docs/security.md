## Who can move money

Nobody, directly. Money moves only when an event (activation, an accepted delivery, a deadline) fires a rule in proved terms. The engine turns that into PayPal effects in a transactional outbox: one effect in flight per promise, each with a `PayPal-Request-Id` so a retry after a crash can never move money twice. A ledger mirror check freezes the promise if what PayPal confirmed ever diverges from what the rules decided.

## Controls

| Threat | Control |
|---|---|
| Account takeover | Convex Auth sessions, password policy (10+ characters, letters and digits), sign-in rate limiting |
| Reading other people's promises | Every function checks participation; outsiders get NOT_FOUND, so ids leak nothing |
| Changing terms after approval | Approvals bind to `termsHash` (terms, both parties, fee, engine version); re-checked at funding |
| Redirecting payouts | Payout email locked at approval; only an arbiter can change it, journaled |
| Faking "verified" | Only server code writes verification results; funding re-checks them |
| Double payments | Outbox with idempotency keys, a crash reaper, one effect per stream at a time |
| Authorization expiry | The verifier enforces PayPal's window; an expiry guard captures to escrow a day early; just-in-time reauthorization |
| Stray payments | Money PayPal takes on a closed or replaced checkout is returned automatically |
| Funds that later fail | Payouts wait while a capture is `PENDING` at PayPal |
| Forged PayPal webhooks | Verified with PayPal's API, de-duplicated by event id; webhooks never move money by themselves |
| Prompt injection | Untrusted wrapping, structured outputs, a manipulation flag, challenge windows, human arbiters |
| Rogue AI agents | Deterministic guard, caps, allowlists, velocity limits, expiry; AI can only escalate |
| Stolen tokens | API keys, agent tokens and invites are 256-bit random, shown once, stored as SHA-256, scoped, expiring and revocable |
| Floods and abuse | Token-bucket rate limits on compile, create, uploads, invites, verify, agent spends and the REST API |
| SSRF through webhooks | Endpoints must be public HTTPS hostnames; private ranges, metadata hosts and trailing-dot tricks are blocked; redirects aren't followed |
| Tampering with history | Hash chain plus Ed25519 signatures plus signed Merkle checkpoints |
| Clickjacking and look-alikes | `frame-ancestors 'none'`, a strict CSP, an official-host warning, same-site-only redirects |

## What the AI can and can't do

| Can | Can't |
|---|---|
| Draft promises and rules from plain English | Change a promise to make rules pass |
| Repair rules the verifier rejected | Fund, release, refund or pay anything |
| Check a delivery against agreed criteria | Accept a delivery on its own (a pass opens a challenge window) |
| Screen an agent's purchase against its purpose | Approve a purchase the deterministic guard blocks |

## Verify the history yourself

1. Fetch the public keys: [`{{KEYS}}`]({{KEYS}}).
2. Download a promise's proof pack (`GET /v1/contracts/{id}/proof`) or open the promise and press **Verify in browser**.
3. Or audit offline: `npx @kept/mcp verify-proof pack.json` re-derives every hash, checks every signature and re-runs the verifier.
4. Check that an entry is in the public log: `GET /v1/transparency/proof/{entryHash}`.

## Known limits

- Email ownership isn't verified at sign-up; invite links are single-use bearer secrets.
- In the sandbox design, escrow-mode funds sit in the platform's PayPal balance; production should use PayPal's multiparty flows.
- Arbiters are trusted people. Every arbiter action needs a reason and is visible to both sides.
