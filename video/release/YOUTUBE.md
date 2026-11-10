# YouTube upload text

## Title

Kept: money moves only when a promise is kept (PayPal + Claude)

## Description

You pay a deposit and the work never arrives. Or you do the work and never get paid. The payment worked; the promise didn't.

Kept turns a deal you describe in plain English into payment rules, proves those rules can't break either side's promise across every possible order of deliveries, reviews and deadlines, holds the money with PayPal, and releases it only when the promise is kept. Every cent leaves a signed, hash-chained trail that nobody can rewrite, not even us. The same engine gives an AI agent a budget instead of your card: it can buy what you allowed, asks you above a limit, and is refused everything else.

In this video
0:00 The problem
0:22 Say it: describe the deal
0:36 Prove it: every possible path, a real bug caught, then proved
1:03 Hold it: both sides approve the same fingerprint; the money is held
1:17 Keep it: delivery, acceptance, settlement
1:31 Try to cheat: rewrite the money trail, and watch it break
1:51 Agents: a budget, not your card
2:13 Kept

How this demo was recorded
- Everything in the app is real and running: a local deployment of Kept (Convex backend + Next.js) with two test accounts, driven end to end on camera.
- Payments run on Kept's PayPal simulator, which stands in for approving on paypal.com. No real money moved, and this video does not show the PayPal sandbox.
- The step where Claude drafts the rules from your words is shown as an illustration; the rules on screen are a pre-proved template. The verifier results, the counterexample, the money trail tamper test and the agent API responses are real output.

Code: https://github.com/willburhachita/kept
Voice: synthesized (Kokoro, open weights). Music and sound effects: synthesized in code for this video.

Built for the PayPal AI Hackathon 2026.
