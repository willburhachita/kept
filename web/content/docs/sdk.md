`@kept/sdk` is a small typed client for the REST API. It works anywhere `fetch` exists: Node 20+, Bun, Deno, edge runtimes.

```bash
npm i @kept/sdk
```

## Promises

```ts
import { Kept } from "@kept/sdk";

const kept = new Kept({ baseUrl: "{{API}}", apiKey: process.env.KEPT_API_KEY! });

const { contractId, inviteUrl } = await kept.contracts.create({
  role: "funder",
  prompt: "$100 now, $200 when she delivers the final logo as SVG, refund me if nothing arrives in 7 days",
  counterpartyEmail: "designer@example.com",
  compile: true,
});

const c = await kept.contracts.get(contractId);
c.verification?.report.properties;            // proofs and counterexamples
await kept.contracts.approve(contractId, c.termsHash!);
const { approveUrl } = await kept.contracts.fund(contractId);   // redirect the payer
await kept.contracts.confirmFunding(contractId);                  // after PayPal approval
await kept.contracts.uploadEvidenceFile(contractId, "final_svg", file, "image/svg+xml", "logo.svg");
```

`confirmFunding` returns `{ status }` plus `pending: true` while PayPal is clearing the payment, or `returned: true` when the payment arrived but the promise could no longer start (the money is being returned). If the payer leaves PayPal without approving, `kept.contracts.resetFunding(contractId)` abandons that checkout so you can fund again or cancel.

## Verify a contract

```ts
const result = await kept.verify(ir, 250); // uses your key, rate limited per account
```

`verify` from `@kept/core` does the same offline, with no network:

```ts
import { verifyContract } from "@kept/core";
const r = verifyContract(ir, { feeBps: 250 });
```

## Agents

```ts
import { KeptAgent } from "@kept/sdk";

const agent = new KeptAgent({ baseUrl: "{{API}}", mandateToken: process.env.KEPT_MANDATE_TOKEN! });
const m = await agent.getMandate();
const s = await agent.requestSpend({
  merchantEmail: "orders@shop.com",
  merchantName: "Shop",
  amountCents: 2500,
  description: "printer paper",
});
s.status; // executing | screening | needs_approval | denied (final)
```

## Webhooks and receipts

```ts
import { verifyWebhook, verifyJournalEntry } from "@kept/sdk";

const event = verifyWebhook({ secret: process.env.KEPT_WEBHOOK_SECRET!, headers: req.headers, body: rawBody });
const ok = verifyJournalEntry(event.data, publicKeyHex); // signature + hash
```

## Errors

Every failure is a `KeptApiError { status, code, message, details }`. `code` is one of the [API error codes](/docs/api#conventions), or `NETWORK` / `TIMEOUT`.

```ts
try {
  await kept.contracts.approve(id, hash);
} catch (e) {
  if (e instanceof KeptApiError && e.code === "INVALID_STATE") {
    // re-read the contract and follow nextActions
  }
}
```
