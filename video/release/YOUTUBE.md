# YouTube upload text

Demo video: **https://youtu.be/v9mtU_jdPBI** (3:26). The video files aren't kept in the repo; rebuild them with `node video/render.mjs --cut short|full` (see `video/BRIEF.md`).

- Submission cut (`--cut short`): 2:52.
- Extended cut (`--cut full`): 3:26. It adds an opening joke, the link checker, agent decisions explained, and the developer and tech-stack section.

## Title

Kept: money moves only when a promise is kept (PayPal + Claude)

## Description (submission cut)

You paid the deposit; the designer replied with a read receipt. Or you delivered, and the client vanished. The payment worked. The promise didn't.

Kept turns a deal you describe in plain English into payment rules, proves those rules can't break either side's promise across every possible order of deliveries, reviews and deadlines, holds the money with PayPal, and releases it only when the promise is kept. Every cent leaves a signed, hash-chained trail that nobody can rewrite, not even us. The same engine gives an AI agent a budget instead of your card: it buys what you allowed, asks you above a limit, and is refused everything else.

0:00 The problem
0:19 Say it: describe the deal (and Kept flags scams)
0:38 Prove it: every possible path, a real bug caught, then proved
1:07 Hold it: same fingerprint, money held by PayPal
1:27 Keep it: delivery, acceptance, payout, a second example
1:47 Try to cheat: rewrite the money trail and watch it break
2:10 Agents: a budget, not your card
2:38 Kept

How this demo was recorded
- Everything in the app is real and running: a local deployment of Kept (Convex backend + Next.js) with two test accounts, driven end to end on camera.
- Payments run on Kept's PayPal simulator, which stands in for approving on paypal.com. No real money moved, and this video does not show the PayPal sandbox.
- The step where Claude drafts the rules from your words is shown as an illustration; the deal on screen uses a pre-proved template. The verifier results, the counterexample, the scam warning, the money trail tamper test and the agent API responses are real output.

Code: https://github.com/willburhachita/kept
Voice: synthesized (Kokoro, open weights). Music and sound effects: synthesized in code for this video.

Built for the PayPal AI Hackathon 2026.

## Chapters for the extended cut

0:00 The problem
0:24 Say it
0:43 Prove it
1:11 Hold it
1:31 Keep it
1:52 Try to cheat
2:20 Agents
3:11 Kept
