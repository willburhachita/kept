# Kept demo video: brief

Hackathon submission video. **Under 3:00** (target about 2:30), 1920x1080, public on YouTube. Deadline Nov 12 2026, 22:00 GMT+2.
Judged on: Technological Implementation, Design, Potential Impact, Innovation, Presentation ("does the video clearly demonstrate the project working end-to-end? what problem, who for, why it matters?"). A separate $5,000 prize is Best Demo Delivery.

## Hard rules

- **No fake product claims.** Show the real app. Animation may explain how it works, but must not imply something happened that didn't. Footage on the simulated rail carries a small corner tag: "Live app · PayPal simulator". Remove it only after re-capturing on the real sandbox.
- **Don't show Claude drafting live unless `ANTHROPIC_API_KEY` is set.** Captions can describe what the product does; the on-screen run must be real or clearly an illustration.
- The agent never types the owner's password or real credentials. The owner signs in themselves. Test accounts are fine only on a backend that is itself local.
- Nothing copyrighted: no music or footage from the references. **All audio is synthesized** in `video/sfx.mjs`.
- Reference clips and anything derived from them (`video/out/`) never go in this public repo.
- Design: Inter 600, tight tracking (-0.05em), two-tone headings, ink #0a0a0a, canvas #f5f5f5, PayPal blue #0066f5. **Monochrome plus blue only: no red, yellow or green, even for failure.** No emojis. Broken = white-hot on black, or black on white.

## What the references taught (three short product films)

1. **Inset stage with chapters.** Content sits in a large rounded card on a glowing gradient frame. Under it, a row of chapter pills (Intro / Problem / Use case / Call to action); the active one is black with a glowing light moving across it, above a ruler of tick marks that acts as a progress bar. *Take this*: it matches Kept's pill nav. Chapters: Problem, Say it, Prove it, Hold it, Keep it, Try to cheat, Agents.
2. **Word-by-word lines on a quiet card.** One sentence builds a word at a time, small icons scatter around it, then a collage orbits the line. Single words get construction guide-lines. Logo draws from a ring, then the name wipes out of it.
3. **Lift UI out of the screen.** On a dark background with one brand-color glow, a tilted device flies in, and single UI cards detach and float, with heavy motion blur on every camera whip. Basically one continuous camera move, almost no hard cuts. One button press becomes the hero moment. A key word in each line takes the brand color.
4. **Brand-color staccato.** Full-bleed brand color alternating with white; a huge logo zooming out; a line with one word in a white box that swaps on the beat ("Thousand of [Inspirations] / [Motion] / [Design]"). A real cursor uses the real UI: modal, typing, button spinner, then a zoom into the toast. Ends on huge single-word cuts on the beat, then the logo.
5. **Sound.** Dense and tight: 2 to 3 effect onsets per second in clusters, every motion has a sound, sitting on a low bed. Loud masters (RMS about -10 to -17 dB, peaks near 0). Silence right before the logo hit.

## The clever idea

**The blue dot from the `Kept.` wordmark is the money.** One continuous dot travels the entire film and carries every transition: it leaves the payer, gets lost in the cold open, lands as the period of the logo, runs every path of the deal in the prover, drops into the PayPal hold, splits into the payouts, and finally settles back into the wordmark.

## Storyboard

| Time | Chapter | What happens | Source |
|---|---|---|---|
| 0:00 | Problem | Black. Chat bubbles: "Logo by Friday?" / "Send $100 to start." / "Sent." The dot leaves. Skip to *Friday*: "Hello?" "Are you there?" Not delivered. Then flip it: a designer who delivered and never got paid. Line: **The payment worked. The promise didn't.** Sound drops out. | animation |
| 0:14 | Title | Dot arcs back and lands as the period of a huge `Kept.`; ring burst, sub hit. "Money moves only when a promise is kept." | animation |
| 0:20 | Say it | Sign-in, then `/new`, the deal typed like a text message. Swapping word box: "Freelancers / Plumbers / Suppliers". | app + animation |
| 0:36 | Prove it | Sentence shatters into rules. Real state graph drawn from `video/out/graph.json` (run `node video/graph.mjs`): the dot races every path, tick ratchet rising. Then `/verify`: real counterexample of the logo draft (see below). Repair, re-prove, every node turns blue, big hit. | animation + app |
| 1:05 | Hold it | Both sides confirm the same 8-character fingerprint (cards slide together, click). Dot drops into the PayPal hold; lock clunk. "Not with a stranger. Not with us." | animation + app |
| 1:22 | Keep it | Delivery, AI check, accept. The dot splits and flows to the payee; money river; certificate zoom. Rising chimes. | app |
| 1:42 | Try to cheat | **Hero moment.** The AG Grid money trail. Cursor changes $200 to $2,000; rows break one after another in a cascade, a glitch hit per row. Tick "Cover my tracks": still broken. "Not even we can rewrite it." | app |
| 2:02 | Agents | "Give an agent a budget, not your card." Terminal of real API answers: paper paid, toner asks you, chair denied, unlisted shop denied, each one hitting a wall. Then the policy backtest grid. | app + animation |
| 2:24 | Close | Staccato on the beat: **Say it. / Prove it. / Hold it. / Keep it.** on full blue and white. Silence. Dot settles: `Kept.` plus URL, GitHub, "PayPal + Claude". | animation |

No voiceover: kinetic captions carry the pitch.

## True numbers to use (from the real prover)

- Logo deal, first draft: `1 property violated: Designer gets $300 for on-time delivery.` 8 states, 4 endings. The race: funded, $100 released up front; the logo is delivered on time; the deadline passes before review, and the refund rule returns $200. Payee should get $300, gets $100.
- Logo deal, repaired: `Proved 6 properties across 9 reachable states.`
- Plumber draft (use for the big graph, it's more dramatic): 63 states, 88 transitions, 33 endings, about 10 ms. Add it to `graph.mjs` output.
- Settled test promise: $300 paid, $7.50 fee, 12 journal entries verified, fingerprint `146c 7fe8`. Contract `kd77yphtyfpq5tryc5z41gy3pn8hm75v`.
- Agent budget `m5763zzsr0nrmy9rdmnxsv25qh8hmeq0`: $200 budget, spent $65, fees $1.63, $135 released on close. Paper paid, toner needs approval, chair denied, unlisted merchant denied, fake token 401.

## Pipeline (no third-party binaries)

Headless Chrome is the renderer and encoder. `studio.mjs` is the local server and launcher.

1. `video/sfx.mjs`: pure-JS synth writes `out/soundtrack.wav` (48 kHz stereo) from a shared cue list. Key ticks, UI clicks, bubble pops, whooshes (swept filtered noise, panned), risers, sub impacts, lock clunk, tick ratchet, glitch bursts, bell chimes, denied thunks, a low original bed, feedback reverb, soft-clip limiter. Master near -12 dB RMS, peaks at -1 dB.
2. `video/timeline.js`: scenes and cues in seconds, one source of truth for picture and sound.
3. `video/index.html`: deterministic `render(t)` on a 1920x1080 canvas. Fonts from `node_modules/@fontsource-variable`. Motion blur by accumulating sub-frames.
4. Encode inside the page: `VideoEncoder` (H.264) and `AudioEncoder` (AAC), then a small hand-written MP4 muxer (moov before mdat); POST to `/save/`. Check `isConfigSupported` first. If `AudioEncoder` lacks AAC, use Opus in MP4.
5. `?still=t1,t2` renders review frames as JPEG. Verify the final file by loading it back: duration, seeks, audio RMS. The agent can't hear audio, so say so and report levels and sync numerically.
6. App footage is stepped capture over CDP (Node's built-in WebSocket): 1440x810 at 2x, one sharp JPEG per step plus target element rects in `shots.json`, so the cursor, ripples and zooms are composited in `render(t)`. Hide the Next dev indicator and set localStorage `kept:guide:seen=1`.
