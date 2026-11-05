Agentic commerce needs a way to let software spend money without handing it a card. Kept's answer is the **agent budget** (a mandate): a verified policy, a budget held on PayPal, and scoped tokens your agents use instead of payment details.

## Create a budget

Describe it in a sentence (Claude drafts the policy) or fill in the fields yourself on **Agents → New agent budget**. A policy has:

| Field | Example |
|---|---|
| Purpose | Restock office supplies for a five-person team |
| Budget | $200 total |
| Per purchase | at most $50 |
| Approval threshold | ask me above $30 (or never) |
| Purchases | at most 10, at most 5 per hour |
| Merchants | `@supplies.example.com`, `orders@coffee.example.com` |
| Expiry | 168 hours (at most 28 days, inside PayPal's authorization window) |

Before you can fund it, Kept proves the caps hold (the budget can't be exceeded, no purchase can bypass a limit) and runs thousands of simulated hostile purchase attempts as a check.

## How a purchase is decided

1. The agent requests a spend with an idempotency key.
2. A **deterministic guard** checks it against the policy: status, expiry, merchant, amount, totals, counts, velocity. Spends still waiting count toward the limits, so an agent can't queue past them.
3. Within limits and under the threshold: an **AI screener** checks the purchase fits the stated purpose. It can only escalate, never approve something the guard blocks.
4. Approved spends are captured from the hold and paid to the merchant on PayPal. Above-threshold spends wait for you. Screening that doesn't finish in 10 minutes escalates to you.

## Connect an agent

Issue a token on the budget's page. It starts with `mt_` and is shown once.

**Remote MCP (no install)**

```bash
claude mcp add --transport http kept {{MCP}} --header "Authorization: Bearer mt_..."
```

**Local MCP server**

```bash
claude mcp add kept -e KEPT_API_URL={{API}} -e KEPT_MANDATE_TOKEN=mt_... -- npx -y @kept/mcp
```

For Claude Desktop or Cursor:

```json
{
  "mcpServers": {
    "kept": {
      "command": "npx",
      "args": ["-y", "@kept/mcp"],
      "env": { "KEPT_API_URL": "{{API}}", "KEPT_MANDATE_TOKEN": "mt_..." }
    }
  }
}
```

## Tools

| Tool | What it does | Needs |
|---|---|---|
| `verify_contract`, `explain_contract`, `contract_language`, `example_contracts` | Write and prove payment contracts | nothing (offline) |
| `verify_mandate`, `check_spend` | Check a policy or a purchase against one | nothing (offline) |
| `verify_proof_pack` | Independently audit a settled promise | nothing (offline) |
| `get_mandate`, `find_products`, `request_spend`, `get_spend` | Find and buy inside a budget | a mandate token |
| `list_contracts`, `get_contract`, `create_contract`, `compile_contract`, `approve_contract`, `contract_proof` | Work with promises | an API key |

## Agent API (REST)

| Method | Path | Body |
|---|---|---|
| GET | `{{API}}/agent/v1/mandate` | What the agent may do right now |
| POST | `{{API}}/agent/v1/spends` | `{ merchantEmail, merchantName?, amountCents, currency?, description, idempotencyKey }` |
| GET | `{{API}}/agent/v1/spends/{id}` | One spend's status |
| POST | `{{API}}/agent/v1/products/search` | `{ query, limit? }`: only offers the budget allows |

Authenticate with `Authorization: Bearer mt_...`. A `denied` answer is final; don't retry it with a new key.

## Shopping inside a budget

`find_products` searches real products through [Channel3](https://channel3.ai). The budget isn't just checked after the search, it shapes the search:

1. **The policy becomes the filters.** The price ceiling is the per-purchase limit or what's left of the budget, whichever is lower. The retailers are the merchant allowlist. Only in-stock, new items.
2. **Every offer meets the purchase guard.** Each retailer offer is checked exactly as a purchase would be: budget, per-purchase cap, allowlist, purchases left, hourly rate, expiry.
3. **The agent sees only what it may buy.** Allowed offers (and ones that would need your approval) come back with a ready-made `purchase` object to pass to `request_spend`. Blocked offers are hidden and only counted, by reason.

The owner's budget page has a preview of the same search that also shows the hidden offers and why. The decision is checked again when the agent calls `request_spend`, so a price change between search and purchase can't slip through. In sandbox, Kept pays the retailer's PayPal stand-in address (an allowlisted PayPal email on the retailer's domain wins).

## Safety notes

- Tokens are stored as SHA-256 hashes, scoped to one budget, expire, and can be revoked instantly.
- Merchant names and descriptions from agents are treated as untrusted text in every AI prompt.
- Closing a budget cancels pending requests and releases the unused hold.
