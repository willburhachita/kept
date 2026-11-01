# Kept

**Every promise, kept.** Plain-English payment agreements, compiled by Claude, **proved** by an exhaustive model checker, and executed on **PayPal** rails, with signed, tamper-evident receipts and safe spending mandates for AI agents.

```
"$100 now, $200 when she delivers the logo, refund me if nothing arrives in 7 days"
   → promises + rules (Claude) → proof over every ordering (verifier) → repair (Claude, rules only)
   → both sign the exact terms hash → PayPal authorization → evidence checked (Claude vision + humans)
   → partial capture + payout → signed hash chain + Merkle checkpoints
```

| | |
|---|---|
| `packages/core` | `@kept/core`: language, verifier, interpreter, receipts, Merkle log, mandate guard (installable, pure TS) |
| `packages/mcp` | `@kept/mcp`: MCP server (`npx -y @kept/mcp`), offline proofs plus agent spending tools |
| `packages/sdk` | `@kept/sdk`: typed REST/agent client, webhook and receipt verification |
| `backend` | Convex backend: auth, engine, PayPal, AI, mandates, REST API, remote MCP |
| `docs` | start with [docs/00-START-HERE.md](docs/00-START-HERE.md) |

```bash
npm install && npm run build && npm test
npx @kept/mcp verify my-contract.json
```

Docs: [Start here](docs/00-START-HERE.md) · [Architecture](docs/01-ARCHITECTURE.md) · [Contract language](docs/02-CONTRACT-LANGUAGE.md) · [Verifier](docs/03-VERIFIER.md) · [PayPal](docs/04-PAYPAL.md) · [AI](docs/05-AI.md) · [Security](docs/06-SECURITY.md) · [Agents & MCP](docs/07-AGENTS-AND-MCP.md) · [Backend API](docs/08-BACKEND-API.md) · [UI blueprint](docs/09-UI-BLUEPRINT.md) · [Setup](docs/10-SETUP-AND-DEPLOY.md) · [Demo](docs/11-DEMO-SCRIPT.md)

MIT licensed.
