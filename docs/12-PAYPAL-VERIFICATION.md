# How the PayPal integration was verified

## The situation, plainly

Kept's PayPal integration is real code: `backend/convex/rails/paypal.ts` calls PayPal's REST APIs for orders, authorizations, partial captures, reauthorizations, voids, refunds, payouts and webhook verification. The author couldn't sign in to the PayPal Developer Dashboard before the deadline, so there were no sandbox keys, and **the code has not yet run against the live PayPal sandbox**. The demo video uses Kept's built-in simulator and says so on screen.

Rather than leave the PayPal path untested, it was tested end to end against PayPal's **own published contract**. Judges with sandbox keys can run it for real in about 10 minutes ([JUDGES.md](../JUDGES.md)).

## What was done

**1. PayPal's official API specifications are in the repo.** `backend/tests/paypal/specs/` holds PayPal's OpenAPI files for Orders v2, Payments v2, Payouts v1 and Webhooks v1. They come from [github.com/paypal/paypal-rest-api-specifications](https://github.com/paypal/paypal-rest-api-specifications) at commit `90e8041`, under PayPal's Apache-2.0 licence (included). All 12 REST endpoints Kept calls are defined there.

**2. A stand-in PayPal that is strict in both directions** (`backend/tests/paypal/fake-paypal.ts`):

- **Every request Kept sends** is validated against PayPal's schema for that endpoint: field names, types, required fields, maximum lengths, allowed values, patterns, and that the endpoint exists at all.
- **Every reply the stand-in gives** is validated against PayPal's response schema too. So the tests can't pass by agreeing with a made-up PayPal. This caught two mistakes in the stand-in itself (a merchant ID and a webhook ID in the wrong format), which shows the check is live.
- On top of the shapes, it enforces PayPal's documented money rules. Some of them are rules integrations commonly trip over in the sandbox:

| PayPal behaviour | How the stand-in enforces it |
|---|---|
| The buyer must approve before an order is authorized | `422 ORDER_NOT_APPROVED` |
| You can't capture more than is still held | `422 MAX_CAPTURE_AMOUNT_EXCEEDED` |
| A fully captured authorization can't be captured or voided again | `422 PREVIOUSLY_CAPTURED` |
| An expired authorization can't be captured | `422 AUTHORIZATION_EXPIRED` |
| An invoice number can be used once per merchant | `422 DUPLICATE_INVOICE_ID` |
| Refunds can't exceed the capture | `422 REFUND_AMOUNT_EXCEEDED` |
| Reauthorization only after the 3-day honor period (days 4–29) | refused before day 4 |
| `PayPal-Request-Id` makes a retried call return the original result | replayed, including refusals (assumed worst case) |
| A reused payout `sender_batch_id` is rejected with a link to the original batch | `400` with the link |
| Payouts to an email with no PayPal account end **unclaimed** | `UNCLAIMED` item status |
| Payouts needs its own permission on the app | `403` without it |
| Webhook signatures are confirmed by PayPal | `SUCCESS` or `FAILURE` |

**3. Kept's real flows run through it** (`backend/tests/paypal/paypal-contract.test.ts`, `npm run test:paypal`). These are the same lifecycles the simulator tests run, but on the PayPal code path:

- **A full logo deal.** Funding asks the buyer to approve on PayPal, and confirming early is refused politely. Then: authorize $307.50, capture $102.50 and pay out $100, deliver, accept, renew the hold after the honor period, capture $205 and pay out $200, settle. PayPal's own record and Kept's books agree to the cent.
- **Nothing delivered.** The uncaptured $205 is voided, so the buyer is only ever charged what was released.
- **The connection drops after PayPal has already captured or paid.** Kept retries with the same `PayPal-Request-Id` and money moves once, not twice.
- **PayPal rejects a payout retry as a duplicate batch.** Kept recovers the original payout from PayPal's link instead of paying again.
- **The payee's email has no PayPal account.** The deal still completes, and the payout is unclaimed, as in the sandbox.
- **The buyer closes the tab after approving.** PayPal's `CHECKOUT.ORDER.APPROVED` webhook confirms the funding, and webhooks with bad signatures are dropped.
- **An agent budget.** Funded by authorization, merchants paid by capture and payout, the rest voided on close.
- **The setup self-check** (`npm run paypal:check`) on a correct app, a wrong secret, an app without Payouts, and missing keys.

The run asserts that across all of this, **there are zero violations of PayPal's published specs.**

## What it found and fixed

1. **A payment could get stuck.** If someone pressed "confirm" before approving on PayPal, the authorize call was refused. If PayPal remembers that refusal under the retry key (it doesn't document either way), every later confirm would get the same refusal, even after approving. Kept now checks the order's status with PayPal first and only authorizes once the buyer has approved. (`requireBuyerApproval` in `funding.ts`, used for deals and agent budgets.)
2. **A dead login token wasn't recovered.** Kept caches its PayPal access token. If PayPal stopped accepting it early (for example after the secret was changed), the next payment failed. Kept now fetches a fresh token and retries once.
3. **Two setup traps** a judge would hit before PayPal was even involved:
   - The default `SITE_URL` was `localhost:5173`, but the web app runs on `localhost:3000`, so PayPal would have sent buyers back to a dead page.
   - The app's security policy only allowed hosted Convex addresses, so on a local backend, sign-in hung. Both are fixed and checked in a real browser.
4. **No way to know if a setup was right.** `npm run paypal:check` now checks it against your real sandbox in seconds, with harmless calls, and prints the fix for anything wrong.

## What this does and doesn't prove

It proves that every request Kept makes has the exact shape PayPal's specifications require. It proves that Kept's money logic is correct under PayPal's documented rules, including retries, duplicates and failures, and that Kept and PayPal agree on every cent.

It can't prove behaviour PayPal doesn't specify. That includes the exact text of some error messages, whether PayPal replays refusals under a retry key, and how a sandbox account's settings (country, enabled features) change what's allowed. Where the specs are silent, the stand-in assumes the stricter behaviour, and Kept was made to handle both. The final proof is a run against the real sandbox, which takes 10 minutes with [JUDGES.md](../JUDGES.md).
