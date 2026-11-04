This is the pattern for platforms where your users pay each other: freelance marketplaces, home-services apps, B2B ordering, creator commissions. Your platform keeps its own UX; Kept holds the money, enforces the rules and keeps the receipts.

## Who calls what

| Step | Who | Call |
|---|---|---|
| Create the promise | Your server, for the user who starts the deal | `POST /v1/contracts` |
| Show the proved terms | Your UI | `GET /v1/contracts/{id}` (render `rendered`, `verification`, `nextActions`) |
| Invite the other side | Your app sends the `inviteUrl` | The invitee accepts on Kept, or you call `POST /v1/invites/accept` with their key |
| Approve | Each side | `POST /v1/contracts/{id}/approve` with `termsHash` |
| Fund | The payer | `POST /v1/contracts/{id}/fund`, then redirect to `approveUrl` |
| Confirm | Your return page | `POST /v1/contracts/{id}/fund/confirm` |
| Deliver | The payee | `POST /v1/contracts/{id}/uploads` then `POST /v1/contracts/{id}/evidence` |
| Review | The payer | `POST /v1/evidence/{id}/accept`, `reject`, `challenge`; the payee can `dispute` |
| Track | Your server | Webhooks for every journal event |

Each user acts with **their own** API key, so Kept's authorization checks hold for every call: a payer can't approve on behalf of a payee, and nobody can read a promise they're not part of.

## Rules for a safe integration

1. **Drive every button from `nextActions`.** It is computed on the server for the calling user. If an action isn't there, don't show it.
2. **Trust webhooks, not redirects.** A user landing on your `?funding=approved` page proves nothing. Call `fund/confirm` (idempotent) or wait for the signed webhook.
3. **Verify every webhook signature** with `verifyWebhook` from `@kept/sdk` and reject anything older than five minutes.
4. **Show the terms fingerprint** (first 8 characters of `termsHash`) wherever users approve, and encourage them to compare it.
5. **Keep API keys on your server.** Never ship them to a browser or app.
6. **Use the formatted money strings** the API returns, and show every number: hold, fee cap, captured, paid out, voided, refunded.
7. **Don't let users edit amounts after approval.** Any change creates new terms with a new fingerprint and both approvals reset, by design.

## Statuses to design for

| Status | Show |
|---|---|
| `draft`, `compiling`, `verifying` | Progress (`GET /compile` steps) |
| `needs_attention` | The counterexample and the AI's questions; let users rephrase |
| `review` | Promises, rules, the proof, both approval states, the fingerprint |
| `awaiting_funding`, `funding` | The hold amount and a PayPal button |
| `active` | Money held / released / returned, deadlines, deliveries |
| `settling` | PayPal is executing the final transfers |
| `settled` | A certificate and the proof pack |
| `frozen` | The reason; nothing moves until an arbiter resumes it |
| `cancelled` | Closed before any money moved |

## Redirect URLs

PayPal returns the payer to `{{APP}}/contracts/{id}?funding=approved` (or `cancelled`). If your platform hosts the flow, set the deployment's `SITE_URL` to your own domain and serve those paths. Abandoned checkouts can be reset with `POST /v1/contracts/{id}/fund/reset`; cancelling is refused while a checkout is open, so a late approval can never strand money.

## Sandbox to production

Switch `PAYMENT_RAIL` from `sim` to `paypal`, set the PayPal REST credentials and webhook id, and test with sandbox buyer and seller accounts first. See [Fees & money flows](/docs/fees) for exactly which PayPal calls happen when.
