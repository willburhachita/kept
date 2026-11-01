# Setup, test and deploy

Requirements: Node 20+ (tested on Node 25), npm, a Convex account, PayPal sandbox app, Anthropic API key.

```bash
npm install                 # workspaces: packages/core, packages/sdk, packages/mcp, backend
npm run build               # builds @kept/core, @kept/sdk, @kept/mcp
npm test                    # 47 tests: core, mcp, sdk, backend lifecycles (convex-test, sim rail)
```

## Convex

> **Your Convex team is currently Disabled** (Convex refused to create a project: "Project cannot be created or modified while your team is Disabled"). Open https://dashboard.convex.dev → team settings → Billing/Usage and re-enable it, or create a new team. Until then, everything still type-checks and tests offline:
> `node backend/scripts/offline-codegen.mjs` writes `backend/convex/_generated` without a deployment.

Once the team works:

```bash
cd backend
npx convex dev --once --configure new --project kept    # creates the project, pushes functions, writes .env.local
node scripts/setup-keys.mjs                             # JWT keys, receipt signing key, SITE_URL, PAYMENT_RAIL=sim, FEE_BPS
npx convex env set ANTHROPIC_API_KEY <key>
npx convex env set PAYPAL_CLIENT_ID <sandbox client id>
npx convex env set PAYPAL_CLIENT_SECRET <sandbox secret>
npx convex env set PAYPAL_WEBHOOK_ID <webhook id>
npx convex env set PAYMENT_RAIL paypal
npx convex run users:grantRole '{"email":"you@example.com","role":"arbiter"}'   # after you sign up
npx convex dev                                          # live development
npx convex deploy                                       # production
```

## Environment variables

| Name | Required | Meaning |
|---|---|---|
| `JWT_PRIVATE_KEY`, `JWKS` | yes | Convex Auth session keys (setup-keys) |
| `RECEIPT_SIGNING_KEY` | yes | 32-byte hex Ed25519 seed (setup-keys); the public key is served at `/.well-known/kept-keys.json` |
| `SITE_URL` | yes | frontend origin for invite links and PayPal return URLs |
| `PAYMENT_RAIL` | yes | `paypal` or `sim` (deterministic, no network; tests and offline demos) |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | for paypal | sandbox REST app |
| `PAYPAL_WEBHOOK_ID` | for webhooks | from the PayPal developer dashboard |
| `PAYPAL_ENV` | no | `live` for production (default sandbox) |
| `ANTHROPIC_API_KEY` | for AI | compiler, examiner, screener (without it: templates, manual review) |
| `AI_MODEL` | no | default `claude-opus-5-5` |
| `FEE_BPS` | no | default 250 (2.5%) |
| `BRAND_NAME` | no | display name in PayPal and emails |

## Publishing the packages

```bash
npm run build
cd packages/core && npm publish      # then sdk, then mcp
```
Rename first if you pick a different brand: `node scripts/rename.mjs <NewName>`, then `npm install`.

## Hackathon checklist

- [ ] Public repo with `LICENSE` (MIT, included)
- [ ] Deployed backend URL + sandbox test accounts in the README
- [ ] Video under 3 minutes (`11-DEMO-SCRIPT.md`)
- [ ] AI tools used: Claude (`claude-opus-5-5`) for compile, repair, evidence, screening; Claude Code for building
- [ ] Sandbox PayPal integration (Orders, Payments, Payouts, Webhooks)
