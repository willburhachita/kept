Every journal event on a promise or agent budget you're part of can be delivered to your server as a signed HTTP POST. Webhooks are how your platform stays in sync without polling.

## Register an endpoint

In **Settings & developers**, or by API:

```bash
curl -X POST {{API}}/v1/webhooks/endpoints \
  -H "Authorization: Bearer $KEPT_API_KEY" -H "content-type: application/json" \
  -d '{ "url": "https://your-app.com/webhooks/kept", "events": ["contract.*", "paypal.*", "evidence.*"] }'
```

The response includes a signing `secret` (`whsec_...`), shown once. Endpoints must be public HTTPS URLs; private and internal addresses are refused.

## Event types

Event types are the journal entry types. Filter with exact names or prefixes like `paypal.*`; `*` means everything.

| Prefix | Examples |
|---|---|
| `contract.*` | `contract.created`, `contract.joined`, `contract.activated`, `contract.settling`, `contract.settled`, `contract.frozen`, `contract.resumed`, `contract.cancelled` |
| `terms.*` | `terms.set`, `terms.verified`, `terms.rejected`, `terms.approved` |
| `funding.*` | `funding.order_created`, `funding.reset`, `funding.protective_capture` |
| `paypal.*` | `paypal.authorized`, `paypal.captured`, `paypal.capture_pending`, `paypal.capture_completed`, `paypal.payout_sent`, `paypal.reauthorized`, `paypal.voided`, `paypal.refunded`, `paypal.failed`, `paypal.stray_funds`, `paypal.stray_returned` |
| `evidence.*` | `evidence.submitted`, `evidence.examined`, `evidence.passed`, `evidence.review_needed`, `evidence.challenged`, `evidence.funder_rejected`, `evidence.disputed`, `evidence.arbitration` |
| `mandate.*`, `spend.*` | `mandate.created`, `mandate.activated`, `mandate.closing`, `mandate.closed`, `spend.requested`, `spend.approved`, `spend.needs_approval`, `spend.escalated`, `spend.paid`, `spend.declined` |

## Signatures

Kept follows the [Standard Webhooks](https://www.standardwebhooks.com) scheme. Each request carries:

| Header | Value |
|---|---|
| `webhook-id` | Unique delivery id (use it to de-duplicate) |
| `webhook-timestamp` | Unix seconds |
| `webhook-signature` | `v1,<base64 HMAC-SHA256 of "id.timestamp.body">` |

Verify before you parse, using the **raw** body:

```ts
import { verifyWebhook } from "@kept/sdk";

export async function POST(req: Request) {
  const body = await req.text();
  let event;
  try {
    event = verifyWebhook({ secret: process.env.KEPT_WEBHOOK_SECRET!, headers: req.headers, body });
  } catch {
    return new Response("bad signature", { status: 401 });
  }
  // event.type, event.data (the signed journal entry)
  return new Response("ok");
}
```

`verifyWebhook` rejects timestamps more than 5 minutes off, which stops replays.

## Delivery and retries

- Respond with any 2xx within 10 seconds.
- Failures are retried with backoff; the delivery log in Settings shows each attempt.
- Delivery is at-least-once: de-duplicate on `webhook-id`.
- Order isn't guaranteed across promises; within one promise, use the journal `seq`.

## Don't trust, verify

A webhook says *what happened*. Before acting on money, re-read the promise (`GET /v1/contracts/{id}`): the server's view is always the source of truth. The `data` of each event is a signed journal entry you can check with `verifyJournalEntry` against the [published key]({{KEYS}}).
