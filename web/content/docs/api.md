Base URL: `{{API}}`. All bodies are JSON. Authenticate with an API key from **Settings & developers**:

```bash
curl {{API}}/v1/me -H "Authorization: Bearer sk_..."
```

## Conventions

- **Money** is integer cents (`30000` = $300.00). Views also return formatted strings; display those.
- **Times** are epoch milliseconds.
- **Lists** come back as `{ "data": [...] }`.
- **Errors** are `{ "error": { "code", "message", ...details } }` with an HTTP status:

| Code | Status | Meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Missing, invalid or revoked key |
| `FORBIDDEN` | 403 | You're not allowed to do this on this promise |
| `NOT_FOUND` | 404 | Doesn't exist, or you're not a party to it |
| `INVALID_ARGUMENT` | 400 | The body is wrong (details explain) |
| `INVALID_STATE` | 409 | Not possible in the current status (read `nextActions`) |
| `CONFLICT` | 409 | A concurrent change won; re-read and retry |
| `RATE_LIMITED` | 429 | Slow down; `retryAfterMs` says how long |
| `VERIFICATION_FAILED` | 422 | The terms aren't proved |
| `PAYMENT_FAILED` | 402 | PayPal declined; `paypalCode` has the reason |
| `AI_FAILED`, `CONFIG_MISSING` | 503 | The AI step failed or isn't configured |

## Account

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/v1/me` | | Your profile |
| POST | `/v1/verify` | `{ ir, feeBps? }` | `{ valid, report \| issues }`; rate limited per account |

## Promises (contracts)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/v1/contracts` | `{ role: "funder" \| "payee", prompt, counterpartyEmail?, ir?, compile? }` | `{ contractId, inviteToken, inviteUrl, compiling }` |
| GET | `/v1/contracts` | | `{ data: [card] }` |
| GET | `/v1/contracts/{id}` | | The full view: status, parties, `rendered`, `verification`, approvals, funding, deadlines, ledger, money strings, `nextActions` |
| POST | `/v1/contracts/{id}/compile` | | `{ started, poll }`; Claude writes and proves the rules |
| GET | `/v1/contracts/{id}/compile` | | Live run: `status`, `stage`, `steps[]`, `assumptions`, `questions` |
| PUT | `/v1/contracts/{id}/terms` | `{ ir }` | `{ irHash }`; replaces the terms and re-verifies |
| POST | `/v1/contracts/{id}/approve` | `{ termsHash }` | `{ status }` |
| POST | `/v1/contracts/{id}/cancel` | | Before funding only |
| POST | `/v1/invites/accept` | `{ token }` | `{ contractId }` |

## Funding

| Method | Path | Returns |
|---|---|---|
| POST | `/v1/contracts/{id}/fund` | `{ orderId, approveUrl }`; send the payer to `approveUrl` |
| POST | `/v1/contracts/{id}/fund/confirm` | `{ status, pending?, returned? }`; idempotent |
| POST | `/v1/contracts/{id}/fund/reset` | `{ status }`; abandons a checkout the payer never approved |

## Deliveries (evidence)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/v1/contracts/{id}/uploads` | | `{ uploadUrl, maxBytes, allowedTypes }`; POST the file there to get `{ storageId }` |
| POST | `/v1/contracts/{id}/evidence` | `{ slotId, storageId?, fileName?, text?, url? }` | `{ evidenceId, status }` |
| GET | `/v1/contracts/{id}/evidence` | | `{ data: [item] }` with status, AI verdict, timer and `can*` flags |
| POST | `/v1/evidence/{id}/accept` | | Payer accepts |
| POST | `/v1/evidence/{id}/reject` | `{ reason }` | Payer rejects (payee may dispute) |
| POST | `/v1/evidence/{id}/challenge` | `{ reason }` | Payer objects during the challenge window |
| POST | `/v1/evidence/{id}/dispute` | `{ reason }` | Payee disputes a rejection |

## Receipts

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/v1/contracts/{id}/journal?limit=` | key | `{ data: [signed entry] }` |
| GET | `/v1/contracts/{id}/proof` | key | The proof pack (`kept-proof-pack/v1`) |
| GET | `/v1/transparency/checkpoints?limit=` | public | Signed Merkle checkpoints |
| GET | `/v1/transparency/proof/{entryHash}` | public | Inclusion proof for one entry |
| GET | `/.well-known/kept-keys.json` | public | Ed25519 public keys |

## Agent budgets (mandates)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/v1/mandates` | `{ policy, prompt? }` | `{ mandateId, verified, report }` |
| GET | `/v1/mandates` | | `{ data: [card] }` |
| GET | `/v1/mandates/{id}` | | The full view |
| POST | `/v1/mandates/{id}/fund` | | `{ orderId, approveUrl }` |
| POST | `/v1/mandates/{id}/fund/confirm` | | `{ status, returned? }` |
| POST | `/v1/mandates/{id}/tokens` | `{ label, expiresInHours? }` | `{ token, mcpUrl, agentApiUrl, ... }`, shown once |
| POST | `/v1/mandates/{id}/revoke` | | Closes it and releases the unused hold |
| GET | `/v1/mandates/{id}/spends` | | `{ data: [spend] }` |
| POST | `/v1/spends/{id}/decide` | `{ approve, reason? }` | `{ status }` |

## Webhooks

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/v1/webhooks/endpoints` | `{ url, events? }` | `{ endpointId, url, events, secret }`, secret shown once |

See [Webhooks](/docs/webhooks) for payloads and signatures, and [AI agents & MCP](/docs/mcp) for the agent API (`/agent/v1`).
