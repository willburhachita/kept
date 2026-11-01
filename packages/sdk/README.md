# @kept/sdk

Typed client for the Kept API: verified payment contracts on PayPal, evidence, agent mandates, signed receipts and webhook verification. Works anywhere `fetch` exists.

```bash
npm i @kept/sdk
```

## Contracts

```ts
import { Kept } from "@kept/sdk";
const kept = new Kept({ baseUrl: "https://<deployment>.convex.site", apiKey: process.env.KEPT_API_KEY! });

const { contractId, inviteUrl } = await kept.contracts.create({
  role: "funder",
  prompt: "$100 now, $200 when she delivers the final logo as SVG, refund me if nothing arrives in 7 days",
  counterpartyEmail: "designer@example.com",
  compile: true,
});
// send inviteUrl to the designer; poll kept.contracts.compileStatus(contractId)
const c = await kept.contracts.get(contractId);
c.verification?.report.properties;            // proofs + counterexamples
await kept.contracts.approve(contractId, c.termsHash!);
const { approveUrl } = await kept.contracts.fund(contractId);   // redirect the funder
await kept.contracts.confirmFunding(contractId);                  // after PayPal approval
await kept.contracts.uploadEvidenceFile(contractId, "final_svg", file, "image/svg+xml", "logo.svg"); // as the payee
```

`confirmFunding` returns `{ status }`, plus `pending: true` while PayPal is still clearing the payment (the contract starts once it clears; confirm again to check) or `returned: true` when the payment arrived but the contract could no longer start, so the money is being returned. If the funder leaves PayPal without approving, `await kept.contracts.resetFunding(contractId)` abandons that checkout so you can `fund` again or `cancel`.

`kept.verify(ir, feeBps?)` runs the exhaustive verifier on any contract JSON with your API key (rate limited per account). `verify` from `@kept/core` does the same offline.

## Agents

```ts
import { KeptAgent } from "@kept/sdk";
const agent = new KeptAgent({ baseUrl, mandateToken: process.env.KEPT_MANDATE_TOKEN! });
const m = await agent.getMandate();
const s = await agent.requestSpend({ merchantEmail: "orders@shop.com", merchantName: "Shop", amountCents: 2500, description: "printer paper" });
s.status; // executing | screening | needs_approval | denied (final)
```

## Webhooks and receipts

```ts
import { verifyWebhook, verifyJournalEntry } from "@kept/sdk";
const event = verifyWebhook({ secret: process.env.KEPT_WEBHOOK_SECRET!, headers: req.headers, body: rawBody });
verifyJournalEntry(event.data, publicKeyFrom("/.well-known/kept-keys.json")); // signature + hash
```

Errors are `KeptApiError { status, code, message, details }` (`code` is one of the backend codes, `NETWORK` or `TIMEOUT`).
