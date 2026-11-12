# PayPal REST API specifications (vendored)

PayPal's official OpenAPI 3 specifications, copied unmodified from
[github.com/paypal/paypal-rest-api-specifications](https://github.com/paypal/paypal-rest-api-specifications)
at commit `90e8041ffe02d80c452d2b476bedd59a8d219bdc` (7 April 2026), under the Apache License 2.0 (`LICENSE`, from the same repository).

| File | API | Kept uses |
|---|---|---|
| `checkout_orders_v2.json` | Orders v2 (2.32) | create, get, authorize, capture |
| `payments_payment_v2.json` | Payments v2 (2.12) | capture, reauthorize and void an authorization; refund and get a capture |
| `payments_payouts_batch_v1.json` | Payouts v1 (1.9) | create and get a payout batch |
| `notifications_webhooks_v1.json` | Webhooks v1 (1.11) | verify a webhook signature |

`../fake-paypal.ts` validates every request Kept sends, and every response it returns, against these files.
See [docs/12-PAYPAL-VERIFICATION.md](../../../../docs/12-PAYPAL-VERIFICATION.md).
