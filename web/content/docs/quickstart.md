This walks one promise from creation to settlement on the sandbox. Nothing here moves real money: the deployment runs on the PayPal sandbox or on Kept's built-in payment simulator.

## 1. Get an API key

Sign in, open **Settings & developers**, and create an API key. It starts with `sk_` and is shown exactly once; Kept stores only its SHA-256 hash. Keep it on your server, never in a browser or mobile app.

```bash
export KEPT_API_KEY=sk_...
curl {{API}}/v1/me -H "Authorization: Bearer $KEPT_API_KEY"
```

## 2. Create a promise

Describe the deal in plain English and ask Kept to write and prove the rules:

```bash
curl -X POST {{API}}/v1/contracts \
  -H "Authorization: Bearer $KEPT_API_KEY" -H "content-type: application/json" \
  -d '{
    "role": "funder",
    "prompt": "Pay the designer $300. $100 now, $200 when she delivers the final logo as an SVG. Refund me if nothing arrives in 7 days.",
    "counterpartyEmail": "designer@example.com",
    "compile": true
  }'
```

The response contains `contractId` and a one-time `inviteUrl` for the other side. Compiling takes under a minute; poll `GET /v1/contracts/{id}/compile` or subscribe through webhooks.

No AI key configured? Pass a ready-made contract as `ir` instead of `compile: true` (see [Contract language](/docs/contract-language)); it's verified immediately.

The same with the SDK:

```ts
import { Kept } from "@kept/sdk";

const kept = new Kept({ baseUrl: "{{API}}", apiKey: process.env.KEPT_API_KEY! });
const { contractId, inviteUrl } = await kept.contracts.create({
  role: "funder",
  prompt: "Pay the designer $300. $100 now, $200 when the final SVG logo arrives. Refund me if nothing arrives in 7 days.",
  counterpartyEmail: "designer@example.com",
  compile: true,
});
```

## 3. Read the proof

```ts
const c = await kept.contracts.get(contractId);
c.status;                                 // "review" once proved
c.verification?.report.properties;        // every property, proved or violated
c.verification?.report.outcomes;          // every way the deal can end, with amounts
c.nextActions;                            // what this caller may do next
```

Drive your UI from `nextActions`. Never compute permissions yourself.

## 4. Both sides approve

The other side opens `inviteUrl`, signs in, and reviews the same terms. Each side approves the exact `termsHash`:

```ts
await kept.contracts.approve(contractId, c.termsHash!);
```

The payee must have a PayPal payout email on their profile first; it is locked into the promise at approval.

## 5. Fund on PayPal

```ts
const { approveUrl } = await kept.contracts.fund(contractId);
// redirect the payer to approveUrl; PayPal sends them back to
// {{APP}}/contracts/{id}?funding=approved
await kept.contracts.confirmFunding(contractId);
```

`confirmFunding` returns `{ status }`, plus `pending: true` while PayPal is still clearing an escrow payment, or `returned: true` if the payment arrived on a checkout that had already been closed (Kept returns that money automatically). Kept also confirms by itself when PayPal's webhook arrives, so a closed browser tab is fine.

## 6. Deliver and settle

The payee uploads the deliverable. The AI examiner checks it against the agreed criteria; the payer accepts it (or it passes the challenge window); the rules release the money, and PayPal captures and pays out.

```ts
await kept.contracts.uploadEvidenceFile(contractId, "final_svg", file, "image/svg+xml", "logo.svg");
```

When everything has moved, the status becomes `settled`. Download the proof pack (`GET /v1/contracts/{id}/proof`) and [verify it](/verify) independently.

## Next

- [Webhooks](/docs/webhooks) instead of polling.
- [Embed Kept in your platform](/docs/embedding) for the full integration pattern.
