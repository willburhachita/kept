# Run Kept with your own PayPal sandbox

About 10 minutes. You need Node 20+, a PayPal developer account (sandbox), and optionally an Anthropic API key. Convex (the backend) runs with a free account or locally without one.

> **Why this page exists.** The author couldn't sign in to the PayPal Developer Dashboard before the deadline, so the demo video runs on Kept's built-in PayPal simulator. The real PayPal code is complete. It was tested end to end against a stand-in that checks every call against **PayPal's own published API specifications** (see [How the PayPal integration was verified](docs/12-PAYPAL-VERIFICATION.md)). With your sandbox keys, it runs for real. A self-check tells you within seconds whether your setup is right.

## 1. Install (2 minutes)

```bash
git clone https://github.com/willburhachita/kept && cd kept
npm install && npm run build
npm test                      # 79 tests, including 13 against PayPal's published API specs
```

## 2. Start the backend (2 minutes)

```bash
npm run dev                   # terminal 1: keep it running
```

The first time, Convex asks how to set up. Pick **create a new project** (free account) or **start without an account** (runs locally). Both work. It writes `backend/.env.local`.

## 3. Add your keys (2 minutes)

In a second terminal:

```bash
cd backend
npm run setup:keys -- --rail paypal          # session keys, receipt signing key, SITE_URL=http://localhost:3000, PAYMENT_RAIL=paypal
npx convex env set PAYPAL_CLIENT_ID     <Client ID>      # developer.paypal.com → Apps & Credentials → Sandbox → your app
npx convex env set PAYPAL_CLIENT_SECRET <Secret>
npx convex env set ANTHROPIC_API_KEY    <key>            # optional: turns on Claude (writing deals, checking deliveries, screening agent purchases)
cd ..
```

Make sure the app has **Payouts** ticked under *Features* in the PayPal dashboard. Kept pays people with it.

## 4. Check the setup (10 seconds)

```bash
npm run paypal:check
```

```
Kept · PayPal setup check

  ✓ PAYMENT_RAIL is "paypal"
  ✓ Using the PayPal sandbox (https://api-m.sandbox.paypal.com)
  ✓ PayPal accepted your sandbox credentials (app APP-…)
  ✓ Orders work: PayPal returned a buyer approval link (the test order is never approved; no money moves)
  ✓ Payouts is enabled on your app (Kept pays sellers and payees with it)
  · PAYPAL_WEBHOOK_ID not set (optional) …
  ✓ After approving, PayPal sends buyers back to http://localhost:3000 (run the web app there: npm run dev:web)
  ✓ ANTHROPIC_API_KEY is set (Claude writes and checks deals)

  Ready: Kept will use your PayPal sandbox.
```

Any **✗** line says exactly what to change. Fix it and run the check again.

## 5. Open the app (1 minute)

```bash
npm run setup:web-env         # points the web app at your backend (writes web/.env.local)
npm run dev:web               # terminal 3, then open http://localhost:3000
```

## 6. Try a real deal (3 minutes)

Your PayPal developer dashboard created two sandbox test accounts for you (one personal, one business); find them on its **Sandbox accounts** page. Use the **personal** one to pay. For the payee's payout email, any sandbox personal account works. Create a second one there if you want to see the money arrive.

1. **Sign up** as the payer → **New promise** → **Proved template** → *Logo design, milestone payment*. Enter any email for the other side → **Use this template**.
2. Copy the **invite link** and open it in a private window. **Sign up** as the payee, enter a sandbox personal email as the PayPal payout email, then **Approve terms**.
3. Back as the payer: **Approve terms** → **Hold with PayPal**. Log in on PayPal's sandbox page with the sandbox personal account and approve. PayPal sends you back and the promise goes **Live**: PayPal holds $307.50 and $100 is paid out at once.
4. As the payee: under **Deliver: Final logo (SVG)**, choose any small SVG or image → **Submit delivery**. As the payer: **Accept and release**. The remaining $200 is captured and paid out, and the certificate says **Promise kept**.
5. Then try **Try to rewrite the history** on the same page (change an amount in the money trail and watch it fail verification), and **Agents** → give an agent a $200 budget, fund it with PayPal, and call the agent API with the token it shows you.

You can see the money in PayPal too: log in to sandbox.paypal.com with the sandbox accounts to see the authorization, the captures and the payouts.

## No PayPal keys?

Leave `PAYMENT_RAIL` as `sim` (`npm run setup:keys` without `--rail paypal`). Everything works the same with Kept's simulator, which stands in for the PayPal approval page. That's how the demo video was recorded.

## If something goes wrong

| What you see | Why | Fix |
|---|---|---|
| `✗ PayPal rejected the client ID and secret` | Live keys, or copied from another app | Copy both again with the **Sandbox** tab selected |
| `✗ Payouts is not enabled` | The app lacks the Payouts feature | Dashboard → your app → Features → tick **Payouts** → Save |
| After approving on PayPal, the page doesn't load | `SITE_URL` doesn't match where the web app runs | `cd backend && npx convex env set SITE_URL http://localhost:3000` |
| "Approve the payment on PayPal first, then confirm" | You came back before approving on PayPal | Click **Continue to PayPal**, approve there, and you'll be sent back |
| Sign-in spins forever | The web app points at another backend | `npm run setup:web-env -- --force`, then restart `npm run dev:web` |
| The payout shows **Unclaimed** in PayPal | The payout email has no sandbox account | Normal in the sandbox; use a sandbox personal email to see it arrive |
| "Writing the rules stopped: AI is not configured" | No `ANTHROPIC_API_KEY` | Set it, or use **Proved template** |
| `Can't reach PayPal` | The backend has no internet access | Check the network, then run `npm run paypal:check` again |

Webhooks are optional. Without them, Kept confirms a payment when the buyer comes back from PayPal. With them (`PAYPAL_WEBHOOK_ID`, pointing at `https://<deployment>.convex.site/paypal/webhook`), it also confirms buyers who close the tab, and it hears about disputes and failed payouts. A webhook needs a public URL, so it works with a Convex cloud deployment but not a local one.
