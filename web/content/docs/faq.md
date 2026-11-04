## Is this real money?

This deployment runs on the PayPal sandbox (or Kept's built-in payment simulator), so no real money moves. The same code runs live with production PayPal credentials.

## Who holds the money?

PayPal. Kept asks PayPal to authorize a hold on the payer's account, and tells PayPal when to capture, pay out, void or refund. Kept never sees card numbers or PayPal passwords.

## What does "proved" mean, exactly?

The verifier explores every reachable state of the promise: every order of deliveries, reviews and deadlines, including two happening at the same instant. It checks that money is conserved, nothing gets stuck, PayPal's time limits hold, and every promise holds on every outcome it covers. If any check fails, you see the shortest sequence of events that breaks it.

## What if the AI gets it wrong?

The AI drafts rules and grades deliveries, but it can only propose or escalate. Rules must pass the verifier; both sides approve the exact terms; the payer can challenge any AI pass; disputes go to a human arbiter.

## What if we disagree about a delivery?

The payer can reject it with a reason, or object during the challenge window. The payee can dispute a rejection. A neutral arbiter compares the delivery with the agreed criteria and decides. The money stays held until then.

## Can the payer cancel after funding?

Not unilaterally; that's the point. Before funding, either side can cancel. After funding, money moves only by the rules, or by consent: the payer can release everything early, and the payee can give everything back.

## What does it cost?

2.5% of the money actually released, nothing on refunds, nothing monthly. On a $300 deal that's at most $7.50, and it's shown before you approve. See [Fees & money flows](/docs/fees).

## Which countries work?

Anywhere PayPal can send and receive in the currencies Kept supports (USD, EUR, GBP, CAD, AUD). PayPal's receiving features vary by country; check your account.

## Can I use Kept inside my own app?

Yes: the [REST API](/docs/api), the [SDK](/docs/sdk), signed [webhooks](/docs/webhooks), and an [MCP server](/docs/mcp) for AI agents. Start with the [quickstart](/docs/quickstart).

## Is the code open?

Yes, on [GitHub]({{GITHUB}}).
