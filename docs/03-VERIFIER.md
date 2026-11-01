# The verifier

`verify(ir, { feeBps })` in `packages/core/src/verifier.ts` is an explicit-state model checker. It does a **breadth-first search** over every reachable state, so every counterexample it reports is a **shortest** one. A state is `(activated, closed, deadlines passed, each evidence status and when it was submitted, rules fired, held/released/refunded)`. Every event adds exactly one unit of progress, so the state graph is a layered DAG: it always terminates and is small (the logo contract has 9 states, the two-stage plumber contract 68).

## What it proves

| id | Title | Kind | Fails when |
|---|---|---|---|
| `conservation` | Every cent is accounted for | safety | a rule moves more than is held, or held + released + refunded ≠ principal |
| `no_stranded_funds` | No money gets stuck | liveness | an ending leaves money held forever |
| `promise:<id>` | each promise's label | spec | an ending covered by the promise pays the party less than promised |
| `paypal_window` | Fits PayPal's payment lifecycle | rails | authorize mode: last deadline + worst-case review time > 28 days; escrow mode: > 170 days |
| `no_cutoff` | No review is cut off | fairness (warning) | the contract settles while a submission awaits review and the payee is not fully paid |
| `exhaustive` | Checked every possibility | completeness | more than `maxStates` (default 100,000) states |

Worst-case review time is `resolutionBoundHours(challengeWindow) = max(challengeWindow + 72h, 72h + 48h + 72h)`. It uses the same SLA constants the runtime enforces (`SLA` in core).

## Everything it calculates (`report.*`)

- `properties[]`: status, plain-English detail, and a `counterexample` with numbered `steps` (event, rules fired, transfers, balances after each step, narration) plus an `outcome` sentence.
- `outcomes[]`: every distinct ending, with payee/funder/fee amounts, evidence statuses, whether it settles, and a shortest example path in plain English.
- `bounds`: payee min/max, funder min/max, fee min/max, the most releases and refunds on any path, an upper bound on PayPal API calls, and the earliest and latest settlement hours.
- `lifecycle`: funding mode, authorization amount (principal + max fee), horizon, review bound, latest money movement, whether captures can follow the 3-day honor period (just-in-time reauthorization), and the PayPal step plan in plain English.
- `warnings`: rules that can never fire, and evidence no rule uses.
- `stats`: states, transitions, terminal states, depth, time.

## Why trust it

- The runtime executes the **same `step()` function** the verifier explored. Verified contracts cannot fault at runtime, and the runtime still double-checks its ledger against the machine after every event.
- 28 core tests, including the two seeded bugs (`logoNaive`, `plumberDraft`) and their shortest counterexamples.
- Offline and reproducible: anyone can re-run `verifyContract(ir)` from a proof pack and must get the same `irHash` and result (`npx @kept/mcp verify-proof pack.json`).
