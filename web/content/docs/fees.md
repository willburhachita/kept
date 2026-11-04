## The fee

**2.5% of the money that's actually released**, taken as it's released. Nothing on refunds, nothing monthly. The fee is computed on the cumulative amount released, so splitting a payment into milestones never costs more than paying it at once.

The hold includes the most the fee could ever be, so the money for the fee is never in question.

## Worked example: the $300 logo

Terms: $100 when the promise starts, $200 when the final logo is accepted, everything back if nothing arrives within 7 days.

| Step | Decided by the rules | What PayPal does |
|---|---|---|
| Fund | $300 held | Authorization of **$307.50** ($300 + at most $7.50 fee) |
| Start | $100 to the designer | Capture **$102.50** from the hold; pay out **$100** to the designer |
| Logo accepted | $200 to the designer | Capture **$205.00**; pay out **$200** |
| Settled | Designer $300, client $0 back, fee $7.50 | Nothing left on the hold |

If nothing arrives on time instead:

| Step | Decided by the rules | What PayPal does |
|---|---|---|
| Start | $100 to the designer | Capture $102.50; pay out $100 |
| Deadline passes | $200 back to the client | **Void** the remaining $205.00 of the hold |
| Settled | Designer $100, client $200 back, fee $2.50 | The client was only ever charged $102.50 |

## Funding modes

| Mode | When | How money is held |
|---|---|---|
| Authorize | Promises that finish within 28 days | An authorization on the payer's PayPal. Partial captures as rules release; a void for the rest. |
| Escrow | Longer promises | Captured up front into escrow. Payouts as rules release; refunds for the rest. |

PayPal honors an authorization for 3 days and lets it be reauthorized up to day 29. Kept reauthorizes just in time, and if a hold is about to expire with money still promised, an expiry guard captures the remainder into escrow a day early so no promise can lapse.

## Every number, before you sign

The verifier derives bounds for every promise before anyone pays:

| Bound | Logo example |
|---|---|
| Payee receives | $100 to $300 |
| Payer gets back | $0 to $200 |
| Fee | $2.50 to $7.50 |
| Latest settlement | hour 360 |
| PayPal calls, worst case | 9 |
| Distinct endings | 3 |

They're shown on every promise as chips, and returned by the API in `verification.report.bounds`.

## Agent budgets

The hold is the budget plus the most the fee could be. Each approved purchase captures the amount plus its fee and pays the merchant. When the budget closes, the unused hold is voided.
