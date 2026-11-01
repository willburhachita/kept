# Security model

| Threat | Control | Where |
|---|---|---|
| Account takeover | Convex Auth (JWT sessions), password policy (10+ chars, letters + digits), Convex Auth sign-in rate limiting | `auth.ts` |
| Reading other people's contracts | Every public function authenticates and checks participation; outsiders get NOT_FOUND (no existence oracle); staff access is explicit | `lib/authz.ts` |
| Changing terms after approval | Approvals bind to `termsHash` (IR + parties + fee + engine version); any change resets them; re-checked at activation | `contracts.ts`, `engine.activate` |
| Redirecting the payee's money | Payout email locked at approval; only an arbiter can change it, on a frozen contract, journaled | `contracts.approve`, `arbiter.setPayoutEmail` |
| Faking "verified" | Only server code writes `verifications`; activation re-checks `verification.irHash == irHash` | `verification.ts` |
| Double payment on retries or crashes | Transactional outbox, one effect in flight per stream, `PayPal-Request-Id` on every call, crash reaper | `effects.ts` |
| Logic bugs in contracts | Exhaustive verification before approval; runtime ledger mirror check; freeze on any divergence | `@kept/core`, `engine.ts` |
| Authorization expiring mid-contract | Verifier enforces the window; expiry guard captures to escrow 24 hours early; just-in-time reauthorization | `verifier.ts`, `engine.authorizationMaintenance` |
| Paying out on funds that later fail | `PENDING` captures park their payout until `PAYMENT.CAPTURE.COMPLETED` | `effects.ts`, `webhooks.ts` |
| Forged PayPal webhooks | Verified via PayPal's API with `PAYPAL_WEBHOOK_ID`; de-duplicated by event id; webhooks never move money by themselves | `routes/paypal.ts`, `webhooks.ts` |
| Prompt injection via evidence | Untrusted wrapping, manipulation flag, schema outputs, challenge window, humans | `ai/*`, `evidence.ts` |
| Rogue AI agent | Mandate guard (pure code), caps, allowlist, velocity, expiry, approvals; AI screening only escalates; idempotent requests | `@kept/core/mandate.ts`, `agentApi.ts` |
| Stolen tokens | API keys, agent tokens and invite tokens are 256-bit random, shown once, stored as SHA-256, scoped, expiring, revocable | `lib/secrets.ts` |
| Abuse and floods | Token-bucket rate limits on compile, create, upload, invites, agent spends, API keys and REST calls | `lib/rateLimit.ts` |
| Tampering with history | Per-stream hash chain, Ed25519 signature on every entry, RFC 6962 Merkle checkpoints chained and signed | `lib/journal.ts`, `transparency.ts` |
| SSRF via webhooks | Outbound endpoints must be public https hostnames (no IPs, localhost or credentials); redirects not followed | `outbound.ts` |
| Leaking secrets | Secrets only in Convex env; journal stores hashes and masked emails; HTTP errors never include stack traces | `lib/env.ts`, `routes/public.ts` |

## Verifying a contract's history yourself

1. `GET /.well-known/kept-keys.json` → Ed25519 public key.
2. Download the proof pack (`contracts.proof` or `GET /v1/contracts/{id}/proof`).
3. `npx @kept/mcp verify-proof pack.json` re-derives every hash, checks every signature, re-runs the verifier and compares the result.
4. `GET /v1/transparency/proof/{entryHash}` → Merkle inclusion proof against a signed checkpoint (`verifyInclusion` in `@kept/core`).

## Known limits (honest list)

- Email ownership is not verified at sign-up (no email provider configured); invite links are bearer secrets, optionally bound to an email.
- The platform holds escrow-mode funds in its own PayPal balance in the sandbox design; production should use PayPal's multiparty flows.
- Arbiters are trusted humans; every arbiter action is journaled and visible to both parties.
