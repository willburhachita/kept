# 3-minute demo script

| Time | Show | Say |
|---|---|---|
| 0:00 | Black screen, one line | "Every AI agent is getting the power to move money. Nobody is proving it moves money the way you meant." |
| 0:12 | Type the logo deal | "$100 now, $200 when she delivers the final logo. Refund me if nothing arrives in 7 days." |
| 0:25 | ProofTimeline: promises, then rules | "Claude writes the promises first, then the rules." |
| 0:40 | **Red counterexample plays** | "The verifier checked every possible ordering in under a millisecond and found this: she delivers on time, the deadline fires while the review is still running, and she's cheated out of $200. No human would spot this." |
| 1:05 | Repair, then green | "Claude can only change the rules, never the promises. Proof passes." |
| 1:15 | Both approve the same hash, then the PayPal sandbox approval | "Both sides sign this exact fingerprint. The money stays on the client's PayPal as an authorization." |
| 1:35 | Upload the SVG; the AI checklist ticks; challenge window countdown | "Claude checks the file against the agreed criteria, but it can't move money: the client gets a window to object." |
| 1:55 | Accepted, MoneyRiver animates, payout lands | "A partial capture and a payout, on the real PayPal sandbox. Idempotent, journaled, signed." |
| 2:10 | ReceiptChain turns green in the browser | "Every step is hash-chained and signed. Anyone can verify it offline." |
| 2:25 | Agent console: an MCP agent buys within budget; a $60 request is denied | "Agents don't get your card. They get a mandate. The guard is code, not vibes." |
| 2:45 | Closing card | "Kept. Payments with proofs. Open source core, `npx @kept/mcp`." |

Tip: record the PayPal sandbox steps once, and use `PAYMENT_RAIL=sim` for retakes.
