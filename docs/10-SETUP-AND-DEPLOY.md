# Setup, test and deploy

Requirements: Node 20+, npm, Convex (free account, or local without one), a PayPal sandbox app, an Anthropic API key (optional: without it, proved templates and manual review still work).

The quickest path, step by step, is [JUDGES.md](../JUDGES.md). In short:

```bash
npm install && npm run build
npm test                                   # 79 tests: core, mcp, sdk, backend lifecycles (sim rail), PayPal contract tests
npm run dev                                # terminal 1: Convex backend (first run asks: cloud project or local)
cd backend
npm run setup:keys -- --rail paypal        # JWT keys, receipt signing key, SITE_URL=http://localhost:3000, PAYMENT_RAIL, FEE_BPS
npx convex env set PAYPAL_CLIENT_ID <sandbox client id>
npx convex env set PAYPAL_CLIENT_SECRET <sandbox secret>
npx convex env set ANTHROPIC_API_KEY <key>
npx convex env set PAYPAL_WEBHOOK_ID <webhook id>                                # optional, cloud deployments only
npx convex run users:grantRole '{"email":"you@example.com","role":"arbiter"}'   # optional, after you sign up
cd ..
npm run paypal:check                       # checks the keys, Orders, Payouts, webhook and SITE_URL against your sandbox
npm run setup:web-env && npm run dev:web   # terminal 2: web app on http://localhost:3000
```

Production: `cd backend && npx convex deploy`, set the same variables with `--prod`, `PAYPAL_ENV=live`, and a `SITE_URL` that matches the deployed web app.

## Environment variables

| Name | Required | Meaning |
|---|---|---|
| `JWT_PRIVATE_KEY`, `JWKS` | yes | Convex Auth session keys (setup-keys) |
| `RECEIPT_SIGNING_KEY` | yes | 32-byte hex Ed25519 seed (setup-keys); the public key is served at `/.well-known/kept-keys.json` |
| `SITE_URL` | yes | frontend origin for invite links and PayPal return URLs (default `http://localhost:3000`, where `npm run dev:web` serves) |
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
- [ ] Judges can run it: [JUDGES.md](../JUDGES.md) + `npm run paypal:check`
- [ ] Demo video on YouTube: https://youtu.be/v9mtU_jdPBI
- [ ] AI tools used: Claude (`claude-opus-5-5`) for compile, repair, evidence, screening; Claude Code for building
- [ ] Sandbox PayPal integration (Orders, Payments, Payouts, Webhooks), contract-tested against PayPal's published specs ([12-PAYPAL-VERIFICATION.md](12-PAYPAL-VERIFICATION.md))
