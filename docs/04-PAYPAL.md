# PayPal integration

All calls live in `backend/convex/rails/paypal.ts` behind the `PaymentRail` interface (`rails/types.ts`). PayPal rules used below were checked against PayPal's published OpenAPI schemas, and every call is contract-tested against them ([12-PAYPAL-VERIFICATION.md](12-PAYPAL-VERIFICATION.md)).

| Step | API | Notes |
|---|---|---|
| Create order | `POST /v2/checkout/orders` | `intent` AUTHORIZE (authorize mode) or CAPTURE (escrow); `payment_source.paypal.experience_context` with `user_action: PAY_NOW`, `shipping_preference: NO_SHIPPING`, return/cancel URLs; `reference_id`/`custom_id` = contract id |
| Authorize | `POST /v2/checkout/orders/{id}/authorize` | after buyer approval; we verify the exact amount and currency, else freeze |
| Capture order (escrow) | `POST /v2/checkout/orders/{id}/capture` | |
| Partial capture | `POST /v2/payments/authorizations/{id}/capture` | `amount = release + fee`, `final_capture: false`, `invoice_id = <stream>-<seq>` |
| Reauthorize | `POST /v2/payments/authorizations/{id}/reauthorize` | just in time, before a capture after the 3-day honor period; PayPal allows days 4-29 and multiple reauths; best effort |
| Void | `POST /v2/payments/authorizations/{id}/void` | at settlement, for the uncaptured remainder (refunds + unused fee); allowed after partial captures, not after full capture |
| Refund | `POST /v2/payments/captures/{id}/refund` | escrow mode, partial amounts allocated across captures (newest first) |
| Payout | `POST /v1/payments/payouts` | payee (or merchant for mandates) by EMAIL; `sender_batch_id` = effect id, de-duplicated by PayPal for 30 days |
| Webhook verify | `POST /v1/notifications/verify-webhook-signature` | headers PAYPAL-AUTH-ALGO, -CERT-URL, -TRANSMISSION-ID, -TRANSMISSION-SIG, -TRANSMISSION-TIME + `PAYPAL_WEBHOOK_ID` |

## Robustness

- **Approval first.** Before authorizing (or capturing an escrow order), Kept asks PayPal for the order's status and only proceeds once the buyer has approved. An early "confirm" never spends the authorize call's `PayPal-Request-Id` on a refusal that PayPal could replay later.
- **Token refresh.** A `401` from PayPal clears the cached access token and retries once with a fresh one (same `PayPal-Request-Id`, so it's safe for mutating calls).
- **Setup check.** `npm run paypal:check` checks the credentials, Orders, Payouts permission, webhook and `SITE_URL` against the real sandbox, using harmless calls.
- **Verified against PayPal's specs.** Every call is contract-tested against PayPal's published OpenAPI files: [12-PAYPAL-VERIFICATION.md](12-PAYPAL-VERIFICATION.md).

## Idempotency

Every mutating call sends `PayPal-Request-Id` derived from the outbox effect id (`cap-<id>`, `po-<id>`, `void-<id>`, `refund-<id>`, `reauth-<id>`, `order-<contract>-<terms>`). Timeouts are treated as ambiguous and retried with the same key, so PayPal returns the original result instead of moving money again. A duplicate-`sender_batch_id` error on payouts is recovered by reading the original batch id from PayPal's HATEOAS link.

## Webhooks handled (`webhooks.ts`)

| Event | Action |
|---|---|
| `CHECKOUT.ORDER.APPROVED` | confirm funding even if the funder closed the tab |
| `PAYMENT.CAPTURE.COMPLETED` | release a payout parked behind a `PENDING` capture |
| `PAYMENT.CAPTURE.DENIED` / `REVERSED`, `CUSTOMER.DISPUTE.CREATED` | freeze the contract or mandate, alert arbiters |
| `PAYMENT.PAYOUTS-ITEM.FAILED/BLOCKED/RETURNED/UNCLAIMED/DENIED` | notify the payee (fix payout email) and arbiters |

Events are verified first, de-duplicated by event id, and journaled on the affected stream.

## Sandbox setup

1. Create a REST app at developer.paypal.com (Sandbox). Enable **Payouts** on the app.
2. Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYMENT_RAIL=paypal` (and `PAYPAL_ENV=live` only for production), then run `npm run paypal:check`.
3. Add a webhook pointing to `https://<deployment>.convex.site/paypal/webhook` with the events above; set `PAYPAL_WEBHOOK_ID`.
4. Use a sandbox **personal** account to approve orders, and another sandbox personal account email as the payee's payout email.

Region note: PayPal receiving features vary by country (in Zambia, historically send-only). Target international clients and freelancers in supported countries for the live story; the sandbox works everywhere.

## Production path

In production, release maps to PayPal's multiparty marketplace flows (delayed disbursement / referenced payouts), so funds stay in PayPal's custody instead of the platform's balance.
