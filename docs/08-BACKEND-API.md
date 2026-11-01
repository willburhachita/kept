# Backend API reference (for the UI)

Call these from a Convex React client: `useQuery(api.x.y, args)`, `useMutation(api.x.y)`, `useAction(api.x.y)`. Queries are **reactive**: screens update live without polling. Errors are `ConvexError` with `error.data = { code, message, ... }`. Codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_ARGUMENT`, `INVALID_STATE`, `RATE_LIMITED` (with `retryAfterMs`), `VERIFICATION_FAILED`, `PAYMENT_FAILED` (with `paypalCode`), `AI_FAILED`, `CONFIG_MISSING`, `CONFLICT`.

All money is integer **cents**; every view also returns formatted strings. All times are epoch **ms**.

## Auth and profile
| Function | Kind | Args | Returns |
|---|---|---|---|
| `auth.signIn` / `auth.signOut` | Convex Auth | `{ provider: "password", params: { email, password, flow: "signUp" \| "signIn", name? } }` | session |
| `users.viewer` | query | `{}` | `{ userId, email, displayName, payoutEmail, role, createdAt } \| null` |
| `users.updateProfile` | mutation | `{ displayName?, payoutEmail? \| null }` | |

## Contracts
| Function | Kind | Args | Returns / notes |
|---|---|---|---|
| `contracts.create` | action | `{ prompt, role: "funder"\|"payee", counterpartyEmail?, ir? }` | `{ contractId, inviteToken, inviteUrl }` (invite shown once) |
| `contracts.regenerateInvite` | action | `{ contractId, email? }` | new `{ inviteToken, inviteUrl }` |
| `contracts.acceptInvite` | mutation | `{ token }` | `{ contractId }` |
| `contracts.listMine` | query | `{}` | cards: title, status, myRole, principalCents, heldCents, releasedCents, verified, counterpartyJoined |
| `contracts.get` | query | `{ contractId }` | **view model**: status, parties, invite, ir, rendered (plain English), verification (with full report), approvals, funding (incl. approveUrl for the funder), deadlines (absolute `at`, `passed`), nextDeadline, machine, ledger, money strings, frozen, **nextActions** |
| `contracts.updatePrompt` | mutation | `{ contractId, prompt }` | |
| `contracts.setTerms` | mutation | `{ contractId, ir }` | `{ irHash }` and verification starts |
| `contracts.approve` | mutation | `{ contractId, termsHash }` | `{ status }` (payee needs `payoutEmail`) |
| `contracts.cancel` | mutation | `{ contractId }` | before funding only |
| `contracts.journal` | query | `{ contractId, limit? }` | signed timeline entries |
| `contracts.proof` | query | `{ contractId }` | proof pack (download as JSON) |

`nextActions` values: `compile`, `edit_terms`, `approve`, `fund`, `confirm_funding`, `reset_funding`, `submit_evidence:<slotId>`, `release_all`, `refund_all`, `cancel`, `share_invite`. Drive buttons from it.

## Compile and verify
| Function | Kind | Args | Returns |
|---|---|---|---|
| `compiler.compile` | action | `{ contractId }` | `{ runId, ok, rounds }` (long-running: show `latestRun`) |
| `compiler.latestRun` | query | `{ contractId }` | `{ status, stage, steps[{kind, ok, title, detail, at, data}], assumptions, questions, durationMs, lastReport }` |
| `compiler.runs` | query | `{ contractId }` | history |
| `verification.report` | query | `{ contractId }` | `{ ok, summary, report, current }` (properties, counterexamples, outcomes, bounds, lifecycle) |
| `verification.verifyDraft` | action | `{ ir, feeBps? }` | instant check for an editor, rate limited per account (or import `verify` from `@kept/core` and run it in the browser) |

## Funding and running
| Function | Kind | Args | Returns |
|---|---|---|---|
| `funding.start` | action | `{ contractId }` | `{ orderId, approveUrl }`: redirect the funder to `approveUrl` |
| `funding.confirm` | action | `{ contractId }` | `{ status, pending?, returned? }`: call on return from PayPal (`?funding=approved`). `pending: true`: PayPal is still clearing the payment and the contract starts once it clears (confirm again to check). `returned: true`: the payment arrived but the contract could no longer start, so the money is being returned |
| `funding.reset` | action | `{ contractId }` | `{ status }`: funder abandons a PayPal checkout they never approved (back to `awaiting_funding`, then fund again or cancel). `INVALID_STATE` if the payment was already approved: confirm instead |
| `engine.consentExit` | mutation | `{ contractId, kind: "release_all"\|"refund_all" }` | funder releases all, or payee refunds all |

## Evidence
| Function | Kind | Args | Returns |
|---|---|---|---|
| `evidence.generateUploadUrl` | mutation | `{ contractId }` | `{ uploadUrl, maxBytes, allowedTypes }`: POST the file, read `{ storageId }` |
| `evidence.submit` | mutation | `{ contractId, slotId, storageId?, fileName?, text?, url? }` | `{ evidenceId, status }` |
| `evidence.list` | query | `{ contractId }` | items: slotLabel, criteria, status, **statusLabel**, file URL/sha256, AI verdict per criterion, **timer {kind, endsAt, msRemaining}**, canAccept/canReject/canChallenge/canDispute |
| `evidence.accept` | mutation | `{ evidenceId }` | funder |
| `evidence.reject` | mutation | `{ evidenceId, reason }` | funder → dispute window |
| `evidence.challenge` | mutation | `{ evidenceId, reason }` | funder, during the challenge window → arbitration |
| `evidence.dispute` | mutation | `{ evidenceId, reason }` | payee, after a rejection → arbitration |

## Arbiter (role `arbiter`/`admin`; grant with `npx convex run users:grantRole '{"email":"…","role":"arbiter"}'`)
`arbiter.queue` (query), `arbiter.decide {evidenceId, outcome, reason}`, `arbiter.resume {contractId, note}`, `arbiter.retryEffect {effectId}`, `arbiter.setPayoutEmail {contractId, email, reason}`, `arbiter.resumeMandate {mandateId, note}`.

## Mandates
| Function | Kind | Args | Returns |
|---|---|---|---|
| `mandates.draftFromPrompt` | action | `{ prompt }` | `{ policy, valid, issues, assumptions, report, lines }` |
| `mandates.create` | mutation | `{ policy, prompt? }` | `{ mandateId, verified, report }` |
| `mandates.listMine` / `mandates.get` | query | / `{ mandateId }` | view: lines, report, remainingCents, spent/reserved/fees, purchasesLeft, purchasesLastHour, msUntilExpiry, funding, tokens, spendCounts, pendingApprovals |
| `mandates.fundStart` / `fundConfirm` | action | `{ mandateId }` | like contract funding |
| `mandates.issueToken` | action | `{ mandateId, label, expiresInHours? }` | `{ tokenId, token, prefix, expiresAt, mcpUrl, agentApiUrl }` (token shown once) |
| `mandates.revokeToken` | mutation | `{ tokenId }` | |
| `mandates.spends` | query | `{ mandateId }` | spends with reasons, AI review, canDecide |
| `mandates.decideSpend` | mutation | `{ spendId, approve, reason? }` | |
| `mandates.revoke` | mutation | `{ mandateId }` | closes and voids the remaining hold |

## Notifications, keys, webhooks, transparency
`notifications.list {limit?, unreadOnly?}`, `notifications.unreadCount`, `notifications.markRead {ids?}` ·
`apiKeys.create {label}` (action, key shown once), `apiKeys.list`, `apiKeys.revoke {keyId}` ·
`outbound.createEndpoint {url, events?}` (action, secret shown once), `outbound.listEndpoints`, `outbound.deleteEndpoint`, `outbound.recentDeliveries {endpointId}` ·
`transparency.checkpoints {limit?}`, `transparency.verifyEntry {entryHash}` (public).

## REST API (API keys) and public HTTP
Base: `https://<deployment>.convex.site`. `Authorization: Bearer sk_test_...`. Errors: `{"error":{"code","message",...}}`.

```
GET  /health                                 GET /.well-known/kept-keys.json
GET  /v1/transparency/checkpoints?limit=     (public)
GET  /v1/transparency/proof/{entryHash}      (public)
GET  /v1/me                                  POST /v1/verify {ir, feeBps?}
POST /v1/contracts {prompt, role, counterpartyEmail?, ir?, compile?}     GET /v1/contracts
GET  /v1/contracts/{id}        POST /v1/contracts/{id}/compile    GET /v1/contracts/{id}/compile
PUT  /v1/contracts/{id}/terms {ir}           POST /v1/contracts/{id}/approve {termsHash}
POST /v1/contracts/{id}/fund | /fund/confirm | /fund/reset
POST /v1/contracts/{id}/cancel               POST /v1/contracts/{id}/uploads
POST /v1/contracts/{id}/evidence {slotId, text|url|storageId, fileName?}   GET /v1/contracts/{id}/evidence
POST /v1/evidence/{id}/accept | reject {reason} | challenge {reason} | dispute {reason}
GET  /v1/contracts/{id}/journal?limit=       GET /v1/contracts/{id}/proof
POST /v1/invites/accept {token}
POST /v1/mandates {policy, prompt?}          GET /v1/mandates          GET /v1/mandates/{id}
POST /v1/mandates/{id}/fund | /fund/confirm | /tokens {label, expiresInHours?} | /revoke
GET  /v1/mandates/{id}/spends                POST /v1/spends/{id}/decide {approve, reason?}
POST /v1/webhooks/endpoints {url, events?}
Agent API: /agent/v1/*  (see 07)       Remote MCP: POST /mcp       PayPal: POST /paypal/webhook
```

Every `/v1` route except the two transparency routes needs an API key. `POST /v1/verify` returns `{valid: true, report, warnings}` or `{valid: false, issues}` and shares the per-account verify budget with `verification.verifyDraft` (`RATE_LIMITED` with `retryAfterMs` when it runs out); to verify without a key, run `verify` from `@kept/core` locally. The funding routes behave like `funding.start` / `confirm` / `reset`: `fund/confirm` can return `pending: true` or `returned: true`, and `fund/reset` abandons a checkout the funder never approved.

Outbound webhook payload: `{ type, timestamp, data: { stream, seq, at, actor, type, data, hash, prevHash, sig, keyId } }`, with `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64 HMAC-SHA256>` headers. Verify with `verifyWebhook` from `@kept/sdk`.

Journal event types you will see: `contract.created`, `contract.joined`, `terms.set`, `terms.verified`/`terms.rejected`, `terms.approved`, `compile.*`, `funding.order_created`/`reset`, `paypal.authorized`/`captured`/`payout_sent`/`voided`/`refunded`/`reauthorized`/`failed`, `contract.activated`, `machine.event`, `evidence.*`, `contract.settling`/`settled`/`frozen`/`resumed`/`cancelled`, `mandate.*`, `token.*`, `spend.*`, `paypal.webhook.*`.
