# AI agents: mandates, the agent API and MCP

## Mandates in one minute

1. The owner creates a mandate (policy JSON, or `mandates.draftFromPrompt` from plain English). It is verified: budget cap, per-purchase cap, count cap, expiry inside PayPal's window, merchant scope.
2. The owner funds it with a PayPal **authorization** for budget + max fee. Nothing is charged yet.
3. The owner issues an **agent token** (`mt_…`, shown once) and gives it to the agent.
4. For each purchase the agent asks to spend. The pure guard (`evaluateSpend`) decides `approve`, `needs_approval` (above the owner's threshold) or `deny`. Approved spends may get an AI screening that can only escalate.
5. Executing a spend captures `amount + fee` from the authorization and pays the merchant by PayPal Payout.
6. On expiry or revoke, pending approvals are cancelled and the unused authorization is voided.

## Agent REST API

```
GET  /agent/v1/mandate
POST /agent/v1/spends      { merchantEmail, merchantName, amountCents, currency, description, idempotencyKey }
GET  /agent/v1/spends/{id}
Authorization: Bearer mt_...
```
Spend statuses: `screening`, `needs_approval`, `executing`, `paid`, `denied` (final, with reasons), `failed`, `cancelled`.

## Remote MCP (hosted)

`POST https://<deployment>.convex.site/mcp` (Streamable HTTP, JSON responses). Tools: `get_mandate`, `request_spend`, `get_spend`.

```bash
claude mcp add --transport http kept https://<deployment>.convex.site/mcp --header "Authorization: Bearer mt_..."
```

## Local MCP (`@kept/mcp`, installable)

```bash
npx -y @kept/mcp            # stdio server
npx -y @kept/mcp verify contract.json
```

Claude Desktop (`claude_desktop_config.json`):

```json
{ "mcpServers": { "kept": { "command": "npx", "args": ["-y", "@kept/mcp"],
  "env": { "KEPT_API_URL": "https://<deployment>.convex.site", "KEPT_MANDATE_TOKEN": "mt_...", "KEPT_API_KEY": "sk_test_..." } } } }
```

| Tool | Needs | What it does |
|---|---|---|
| `verify_contract` | nothing | exhaustive proof, counterexamples, outcomes, bounds |
| `explain_contract` | nothing | plain-English rendering |
| `contract_language` | nothing | schemas and semantics guide for writing contracts |
| `example_contracts` | nothing | reference contracts (including two seeded bugs) |
| `verify_mandate` | nothing | mandate caps proof |
| `check_spend` | nothing | dry-run of the guard |
| `verify_proof_pack` | nothing | independent audit of a contract's signed history |
| `get_mandate`, `request_spend`, `get_spend` | `KEPT_API_URL` + `KEPT_MANDATE_TOKEN` | spend under a mandate |
| `list_contracts`, `get_contract`, `create_contract`, `compile_contract`, `approve_contract`, `contract_proof` | `KEPT_API_URL` + `KEPT_API_KEY` | manage contracts |
