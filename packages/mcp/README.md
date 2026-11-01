# @kept/mcp

An MCP server for verified payments. Your AI assistant can write payment contracts, **prove** them before money moves, explain them in plain English, audit proof packs, and spend inside a mandate. Zero dependencies besides `@kept/core`.

## Install

**Claude Code**
```bash
claude mcp add kept -- npx -y @kept/mcp
# with spending / contract tools:
claude mcp add kept -e KEPT_API_URL=https://<deployment>.convex.site -e KEPT_MANDATE_TOKEN=mt_... -- npx -y @kept/mcp
```

**Claude Desktop / Cursor** (`claude_desktop_config.json` / `.cursor/mcp.json`)
```json
{ "mcpServers": { "kept": { "command": "npx", "args": ["-y", "@kept/mcp"],
  "env": { "KEPT_API_URL": "https://<deployment>.convex.site", "KEPT_MANDATE_TOKEN": "mt_...", "KEPT_API_KEY": "sk_test_..." } } } }
```

**Hosted (no install)**: `POST https://<deployment>.convex.site/mcp` with `Authorization: Bearer mt_...` (mandate tools only).

## Tools

| Tool | Args | Offline |
|---|---|---|
| `verify_contract` | `contract`, `fee_bps?` | yes |
| `explain_contract` | `contract`, `fee_bps?` | yes |
| `contract_language` | none | yes |
| `example_contracts` | none | yes |
| `verify_mandate` | `policy`, `fee_bps?` | yes |
| `check_spend` | `policy`, `request`, `state?`, `fee_bps?`, `now_ms?` | yes |
| `verify_proof_pack` | `proof_pack` | yes |
| `get_mandate`, `request_spend`, `get_spend` | see tool schemas | needs `KEPT_MANDATE_TOKEN` |
| `list_contracts`, `get_contract`, `create_contract`, `compile_contract`, `approve_contract`, `contract_proof` | see tool schemas | needs `KEPT_API_KEY` |

## CLI

```bash
npx @kept/mcp verify contract.json        # exit 1 if any property fails; prints counterexamples
npx @kept/mcp explain contract.json
npx @kept/mcp verify-proof proof-pack.json
```

Security: tokens are read from the environment and never logged; stdout carries only protocol messages; a `denied` spend is a final policy answer.
