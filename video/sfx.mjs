/**
 * Soundtrack for the demo video: everything synthesized here (no samples, no music from anywhere),
 * plus the Kokoro voiceover from out/vo. Follows timeline.js, so picture and sound share every moment.
 * Writes out/soundtrack-<cut>.wav (48 kHz, 16-bit stereo) and prints levels.
 *
 *   node video/sfx.mjs short      submission cut
 *   node video/sfx.mjs full       extended cut
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildTimeline } from "./timeline.js";

const CUT = process.argv[2] ?? "full";
const voIndex = JSON.parse(readFileSync(new URL("./out/vo/index.json", import.meta.url)));
const TL = buildTimeline(voIndex, CUT), EV = TL.ev, DURATION = TL.duration;
const SR = 48000, N = Math.ceil(DURATION * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const bedL = new Float32Array(N), bedR = new Float32Array(N), voBus = new Float32Array(N);
const fxL = new Float32Array(N), fxR = new Float32Array(N);

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const db = (d) => 10 ** (d / 20);
function add(t, buf, gain = 1, pan = 0) {
  if (t === null || t === undefined || Number.isNaN(t)) return;
  const s0 = Math.round(t * SR), gl = gain * Math.cos(((pan + 1) * Math.PI) / 4), gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < buf.length; i++) { const j = s0 + i; if (j < 0 || j >= N) continue; fxL[j] += buf[i] * gl; fxR[j] += buf[i] * gr; }
}
const gen = (dur, f) => { const n = Math.round(dur * SR), b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = f(i / SR, i / n); return b; };
function lowpass(b, fc) { const a = 1 - Math.exp((-2 * Math.PI * fc) / SR); let y = 0; for (let i = 0; i < b.length; i++) b[i] = y += a * (b[i] - y); return b; }
function highpass(b, fc) { const a = Math.exp((-2 * Math.PI * fc) / SR); let px = 0, py = 0; for (let i = 0; i < b.length; i++) { const x = b[i]; py = a * (py + x - px); px = x; b[i] = py; } return b; }
function bandSweep(b, f0, f1, q = 4) { let lo = 0, bp = 0; for (let i = 0; i < b.length; i++) { const f = f0 * (f1 / f0) ** (i / b.length), F = 2 * Math.sin((Math.PI * f) / SR), Q = 1 / q; const hi = b[i] - lo - Q * bp; bp += F * hi; lo += F * bp; b[i] = bp; } return b; }

// ---- instruments
const pop = (f = 880) => gen(0.09, (t) => Math.sin(2 * Math.PI * (f * t - 1800 * t * t)) * Math.exp(-t * 45) * 0.8);
const click = () => highpass(gen(0.035, (t) => rnd() * Math.exp(-t * 300) + Math.sin(2 * Math.PI * 3200 * t) * Math.exp(-t * 160) * 0.5), 900);
const key = () => highpass(gen(0.02, (t) => rnd() * Math.exp(-t * 500) * 0.6), 2000);
const whoosh = (dur = 0.55, up = true) => bandSweep(gen(dur, (t, p) => rnd() * Math.sin(Math.PI * p) ** 2), up ? 300 : 3000, up ? 3500 : 250, 2.5);
const riser = (dur) => { const n = gen(dur, (t, p) => rnd() * p ** 2 * 0.6); bandSweep(n, 200, 6000, 3); const s = gen(dur, (t, p) => Math.sin(2 * Math.PI * (110 * t + (300 * t * t) / dur)) * p ** 3 * 0.25); for (let i = 0; i < n.length; i++) n[i] += s[i]; return n; };
const sub = (f0 = 62) => { let ph = 0; return gen(1.4, (t) => { ph += (2 * Math.PI * (f0 * Math.exp(-t * 1.1) + 28)) / SR; return Math.sin(ph) * Math.exp(-t * 2.4) + (t < 0.006 ? rnd() * 0.6 : 0); }); };
const clunk = () => gen(0.5, (t) => Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t * 14) * 0.9 + Math.sin(2 * Math.PI * 1310 * t) * Math.exp(-t * 40) * 0.2 + Math.sin(2 * Math.PI * 2120 * t) * Math.exp(-t * 55) * 0.15);
const bell = (f) => gen(2.2, (t) => (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 3) + 0.25 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t * 6)) * Math.exp(-t * 2.6) * 0.35);
const thunk = () => lowpass(gen(0.22, (t) => Math.sign(Math.sin(2 * Math.PI * 92 * t)) * Math.exp(-t * 18) * 0.7), 900);
const glitch = (dur = 0.28) => { let hold = 0, v = 0; return gen(dur, (t, p) => { if (hold-- <= 0) { hold = 40 + Math.floor(Math.abs(rnd()) * 400); v = rnd(); } return v * (Math.sin(2 * Math.PI * 37 * t) > -0.2 ? 1 : 0) * 0.5 * (1 - p); }); };
const tick = () => highpass(gen(0.012, (t) => rnd() * Math.exp(-t * 700)), 3000);
const boing = () => gen(0.35, (t) => Math.sin(2 * Math.PI * (300 * t + 220 * Math.sin(2 * Math.PI * 9 * t) * 0.02)) * Math.exp(-t * 9) * 0.5); // the joke beats
const poof = () => lowpass(gen(0.4, (t, p) => rnd() * Math.exp(-t * 9) * 0.8), 2200);
const chime = (fs, gap = 0.12) => fs.map((f, i) => [i * gap, bell(f)]);

// ---- bed: a low pad, one chord per scene, plus a soft pulse that thickens with the energy of each scene
const CHORDS = { cold: [55, 82.4, 110], title: [65.4, 98, 130.8, 196], who: [73.4, 110, 146.8, 220], say: [73.4, 110, 146.8, 220], graph: [61.7, 92.5, 123.5], counter: [58.3, 87.3, 116.5], proved: [65.4, 98, 130.8, 164.8], hold: [55, 82.4, 110, 164.8], money: [55, 82.4, 110, 164.8], keep: [73.4, 110, 146.8, 185], plumber: [73.4, 110, 146.8, 185], receipts: [61.7, 92.5, 123.5, 185], cheat: [51.9, 77.8, 103.8], link: [51.9, 77.8, 103.8], agents: [61.7, 92.5, 123.5, 185], dev: [61.7, 92.5, 123.5, 185], close: [65.4, 98, 130.8, 196] };
const PULSE = { cold: 0, title: 0.2, who: 0.6, say: 0.7, graph: 1, counter: 0.5, proved: 0.8, hold: 0.6, money: 0.6, keep: 0.8, plumber: 0.7, receipts: 0.7, cheat: 1, link: 0.8, agents: 1, dev: 0.8, close: 1 };
const BPM = 112, beat = 60 / BPM;
{
  const phases = new Float64Array(8); let air = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR, sc = TL.scenes.find((s) => t >= s.start && t < s.end) ?? TL.scenes.at(-1), prev = TL.scenes[TL.scenes.indexOf(sc) - 1];
    const x = Math.min(1, (t - sc.start) / 0.8), A = CHORDS[sc.id], B = prev ? CHORDS[prev.id] : A;
    let v = 0;
    for (let k = 0; k < 4; k++) { const f = (A[k] ?? A[0] * 2) * x + (B[k] ?? B[0] * 2) * (1 - x); phases[k] += (2 * Math.PI * f) / SR; v += Math.sin(phases[k] + 0.3 * Math.sin(phases[k] * 0.5)) * (k === 0 ? 0.5 : 0.28); }
    // pulse: a soft kick and a filtered off-beat hat, scaled by the scene's energy
    const pe = PULSE[sc.id] ?? 0, bt = (t % beat) / beat, kick = Math.sin(2 * Math.PI * 52 * (t % beat)) * Math.exp(-(t % beat) * 18) * pe * 0.55;
    const hat = (bt > 0.5 && bt < 0.54 ? rnd() * 0.12 : 0) * pe;
    air += 0.02 * (rnd() - air);
    let g = 1;
    const c = EV.cold, cl = EV.close;
    if (t > c.out - 0.6 && t < EV.title.hit) g = Math.max(0, 1 - (t - (c.out - 0.6)) / 0.6); // drop before the title
    if (t >= cl.silence && t < cl.logo) g = 0; // silence before the logo
    if (t > DURATION - 2.5) g *= Math.max(0, (DURATION - t) / 2.5);
    const s = (v * 0.15 + air * 0.45 + kick + hat) * g;
    bedL[i] = s * (1 + 0.15 * Math.sin(2 * Math.PI * 0.07 * t)); bedR[i] = s * (1 - 0.15 * Math.sin(2 * Math.PI * 0.07 * t));
  }
}

// ---- voiceover (placed by the timeline; nothing can overlap because lines are laid end to end)
function readWav(path) {
  const b = readFileSync(path); let o = 12, fmt = null, data = null;
  while (o < b.length) { const id = b.toString("ascii", o, o + 4), sz = b.readUInt32LE(o + 4); if (id === "fmt ") fmt = { ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) }; if (id === "data") data = b.subarray(o + 8, o + 8 + sz); o += 8 + sz + (sz & 1); }
  const n = data.length / 2 / fmt.ch, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data.readInt16LE(i * 2 * fmt.ch) / 32768;
  return { s: out, sr: fmt.sr };
}
const voSpans = [];
for (const [id, v] of Object.entries(TL.vo)) {
  voSpans.push([v.start, v.end]);
  const { s, sr } = readWav(new URL(`./out/vo/${id}.wav`, import.meta.url));
  const n = Math.round((s.length * SR) / sr), s0 = Math.round(v.start * SR);
  for (let i = 0; i < n; i++) { const x = (i * sr) / SR, a = Math.floor(x), f = x - a; if (s0 + i < N) voBus[s0 + i] += (s[a] ?? 0) * (1 - f) + (s[a + 1] ?? 0) * f; }
}
highpass(voBus, 80);
{ let p0 = 0; for (const v of voBus) p0 = Math.max(p0, Math.abs(v)); let env = 0; const thr = p0 * db(-24), at = 1 - Math.exp(-1 / (0.005 * SR)), rl = 1 - Math.exp(-1 / (0.12 * SR));
  for (let i = 0; i < N; i++) { const a = Math.abs(voBus[i]); env += (a > env ? at : rl) * (a - env); if (env > thr) voBus[i] *= (thr * (env / thr) ** 0.25) / env; } }
{ let pk = 0; for (const v of voBus) pk = Math.max(pk, Math.abs(v)); for (let i = 0; i < N; i++) voBus[i] *= db(-3) / pk; }

// ---- effect cues: every onset comes from the shared events
let cues = 0;
const cue = (t, buf, d = -10, pan = 0) => { add(t, buf, db(d), pan); cues++; };
const many = (t, list, d, pan) => list.forEach(([o, b]) => cue(t + o, b, d, pan));
const E = EV;
// cold open
E.cold.anyUpdate.forEach((t, i) => cue(t, pop(980 - i * 60), -9, 0.4));
E.cold.bubbles.forEach((t, i) => cue(t, pop(i % 2 ? 700 : 900), -8, i % 2 ? -0.4 : 0.4));
cue(E.cold.dotLeave, whoosh(0.6), -10, 0.7); cue(E.cold.read, boing(), -9); cue(E.cold.read, click(), -12);
cue(E.cold.flip, whoosh(0.45, false), -10, -0.5); cue(E.cold.logoBubble, pop(900), -8, 0.4); cue(E.cold.logoBubble + 0.55, pop(700), -9, -0.4);
cue(E.cold.poof, poof(), -6, -0.3); cue(E.cold.lastSeen, thunk(), -13);
cue(E.cold.line1, click(), -10); cue(E.cold.line2, click(), -10); cue(E.cold.line2 + 0.4, glitch(0.2), -14);
cue(E.cold.dotReturn - 0.7, riser(1.4), -11);
// title
cue(E.title.hit, sub(), -3); cue(E.title.hit, bell(392), -12); cue(E.title.sub, whoosh(0.4), -16, 0.3);
// who
E.who.swaps.forEach((t) => { cue(t, click(), -10, 0.3); cue(t, whoosh(0.25), -18, 0.3); });
cue(E.who.fridayBubble, pop(820), -8, -0.3); cue(E.who.dots, pop(1200), -16); cue(E.who.dots + 0.25, boing(), -12);
// say it
cue(E.say.screenIn, whoosh(0.6), -9, -0.3); cue(E.say.zoom, whoosh(0.35), -15);
for (let t = E.say.typeStart; t < E.say.typeEnd; t += 0.05 + 0.03 * Math.abs(rnd())) cue(t, key(), -20 + 4 * rnd(), 0.1 * rnd());
cue(E.say.send, click(), -9); cue(E.say.draft, whoosh(0.5), -12); E.say.cards.forEach((t) => cue(t, pop(820), -11)); [0, 0.22, 0.44].forEach((d) => cue(E.say.rules + d, tick(), -12));
cue(E.say.scam, whoosh(0.4), -13); cue(E.say.scamFlag, thunk(), -7); cue(E.say.scamFlag, glitch(0.15), -15);
// prove
cue(E.graph.proves, sub(58), -6); cue(E.graph.proves - 0.6, riser(0.6), -14);
for (let k = 0, t = E.graph.race; t < E.graph.raceEnd; k++, t += Math.max(0.035, 0.15 * Math.exp(-k / 18))) cue(t, tick(), -15 - 6 * Math.abs(rnd()), rnd() * 0.6);
cue(E.graph.count, bell(523), -14); cue(E.graph.ms, click(), -8); cue(E.graph.ms, pop(1100), -12);
cue(E.counter.hit, sub(55), -6); cue(E.counter.hit, glitch(0.3), -13); E.counter.steps.forEach((t) => cue(t, pop(760), -11));
cue(E.counter.bad, thunk(), -6); cue(E.counter.bad, glitch(0.35), -12);
[0, 0.35, 0.7].forEach((d) => { cue(E.proved.repair + d, tick(), -10); cue(E.proved.repair + d + 0.25, pop(900), -14); });
cue(E.proved.hit - 1.0, riser(1.0), -12); cue(E.proved.hit, sub(), -4); many(E.proved.hit, chime([523, 784]), -13);
cue(E.proved.endings, whoosh(0.5), -12);
// hold
cue(E.hold.slide, whoosh(0.5), -11, -0.4); cue(E.hold.click, click(), -6); cue(E.hold.click, bell(659), -16);
for (let i = 0; i < 9; i++) if (i !== 4) cue(E.hold.read + i * 0.1, pop(700 + i * 40), -18);
cue(E.hold.simIn, whoosh(0.5), -11, 0.4); cue(E.hold.simClick, click(), -7); cue(E.hold.drop, whoosh(0.4, false), -12); cue(E.hold.drop + 0.35, clunk(), -4);
cue(E.hold.joke, boing(), -13);
if (E.money) { cue(E.money.auth, click(), -10); cue(E.money.capture, pop(800), -10); cue(E.money.capture + 0.7, pop(900), -10); cue(E.money.voidT, thunk(), -14); }
// keep
cue(E.keep.deliverClick, click(), -8); cue(E.keep.delivered, pop(880), -10); cue(E.keep.acceptClick, click(), -8);
many(E.keep.settled, chime([523, 659, 784, 1046], 0.16), -13);
cue(E.keep.phone, whoosh(0.5), -12, 0.6); E.keep.toasts.forEach((t, i) => { cue(t, pop(1046 + i * 120), -9, 0.6); cue(t, bell(1318), -22, 0.6); });
cue(E.keep.fee, click(), -10);
if (E.plumber) { cue(E.plumber.card, whoosh(0.4), -13); [E.plumber.fee40, E.plumber.rest, E.plumber.noshow].forEach((t) => cue(t, pop(860), -10)); many(E.plumber.home, chime([659, 784], 0.12), -16); }
// receipts
cue(E.receipts.chain, whoosh(0.5), -12); for (let i = 0; i < 8; i++) cue(E.receipts.chain + 0.4 + i * 0.12, tick(), -15);
cue(E.receipts.browser, whoosh(0.4), -14); cue(E.receipts.noacct, click(), -8);
// cheat
cue(E.cheat.title, sub(48), -6); cue(E.cheat.title, glitch(0.2), -12); cue(E.cheat.gridIn, whoosh(0.6), -11);
cue(E.cheat.click, click(), -9); cue(E.cheat.click + 0.15, click(), -11); for (let i = 0; i < 4; i++) cue(E.cheat.typing + i * 0.13, key(), -13);
cue(E.cheat.broken, glitch(0.35), -6); cue(E.cheat.broken, thunk(), -8); cue(E.cheat.broken + 0.35, glitch(0.2), -10);
cue(E.cheat.cover, click(), -8); cue(E.cheat.broken2, glitch(0.35), -6); cue(E.cheat.broken2 + 0.3, glitch(0.25), -9);
cue(E.cheat.truth, whoosh(0.35), -14); cue(E.cheat.notUs, sub(52), -6);
if (E.link) { cue(E.link.type, whoosh(0.3), -15); for (let i = 0; i < 10; i++) cue(E.link.type + i * 0.05, key(), -18); cue(E.link.click, click(), -8); cue(E.link.result, thunk(), -8); }
// agents
cue(E.agents.hook, whoosh(0.6), -11); cue(E.agents.title, sub(60), -9); cue(VOend("a1", -0.9), whoosh(0.5), -12, 0.8);
cue(E.agents.terminal, whoosh(0.5), -12);
E.agents.calls.forEach(([a, b], i) => { for (let k = 0; k < 4; k++) cue(a - 0.1 + k * 0.08, key(), -14); cue(b, i === 0 ? bell(784) : i === 1 ? pop(660) : thunk(), i < 2 ? -11 : -7); });
cue(E.agents.robot, boing(), -10);
if (E.agents.feed) cue(E.agents.feed, whoosh(0.5), -12);
cue(E.agents.backtest, whoosh(0.4), -13); for (let i = 0; i < 2; i++) cue(E.agents.bt20 - 0.1 + i * 0.12, key(), -12); cue(E.agents.blocked, click(), -8);
cue(E.agents.closed, clunk(), -8); many(E.agents.home, chime([659, 784, 1046], 0.14), -14);
if (E.dev) { cue(E.dev.docs, whoosh(0.5), -12); cue(E.dev.mcp, whoosh(0.3), -15); cue(E.dev.embed, whoosh(0.3), -15); E.dev.stackItems.forEach((t) => cue(t, pop(820), -9)); }
// close
cue(E.close.pitch, whoosh(0.7), -10);
E.close.stacc.forEach((t, i) => { cue(t, sub(70 - i * 4), -6); cue(t, click(), -9); });
cue(E.close.logo, sub(), -2); cue(E.close.logo, bell(392), -10); cue(E.close.logo + 0.2, bell(587), -15);
function VOend(id, off = 0) { return TL.vo[id] ? TL.vo[id].end + off : null; }

// ---- reverb on effects, then mix with ducking under the voice
function reverb(src, delays, fb, mix) {
  const out = new Float32Array(N);
  for (const d of delays) { const D = Math.round(d * SR), buf = new Float32Array(N); for (let i = 0; i < N; i++) { buf[i] = src[i] + (i >= D ? buf[i - D] * fb : 0); out[i] += (buf[i] * mix) / delays.length; } }
  return lowpass(out, 5000);
}
const rvL = reverb(fxL, [0.0297, 0.0371, 0.0411, 0.0437], 0.78, 0.5), rvR = reverb(fxR, [0.0313, 0.0359, 0.0423, 0.0451], 0.78, 0.5);
const duck = new Float32Array(N);
{ let env = 0; for (let i = 0; i < N; i++) { const a = Math.abs(voBus[i]); env = a > env ? env + 0.01 * (a - env) : env + 0.00004 * (a - env); duck[i] = 1 - Math.min(0.5, env * 2.2); } }
for (let i = 0; i < N; i++) {
  const bed = db(-6) * duck[i];
  L[i] = bedL[i] * bed + fxL[i] * 0.85 + rvL[i] * 0.35 * duck[i] + voBus[i];
  R[i] = bedR[i] * bed + fxR[i] * 0.85 + rvR[i] * 0.35 * duck[i] + voBus[i];
}
const DRIVE = 3;
{ let p = 0; for (let i = 0; i < N; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i])); for (let i = 0; i < N; i++) { L[i] /= p; R[i] /= p; } }
let hot = 0, sp = 0;
const inVo = (t) => voSpans.some(([a, b]) => t >= a && t < b);
for (let i = 0; i < N; i += 4) if (inVo(i / SR)) { sp++; if (Math.abs(L[i]) * DRIVE > 1.2) hot++; }
let pk = 0;
for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i] * DRIVE) / DRIVE; R[i] = Math.tanh(R[i] * DRIVE) / DRIVE; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
const g = db(-1) / pk;
let ss = 0, vs = 0, vn = 0;
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  const l = L[i] * g, r = R[i] * g; ss += (l * l + r * r) / 2;
  if (i % 4 === 0 && inVo(i / SR)) { vs += (l * l + r * r) / 2; vn++; }
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l)) * 32767), i * 4); pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r)) * 32767), i * 4 + 2);
}
const hdr = Buffer.alloc(44);
hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write("WAVEfmt ", 8); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22);
hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write("data", 36); hdr.writeUInt32LE(pcm.length, 40);
writeFileSync(new URL(`./out/soundtrack-${CUT}.wav`, import.meta.url), Buffer.concat([hdr, pcm]));
const dbf = (x) => (10 * Math.log10(x)).toFixed(1);
console.log(`soundtrack-${CUT}.wav ${DURATION.toFixed(2)}s, ${cues} effect cues, ${voSpans.length} VO lines; peak -1.0 dBFS, RMS ${dbf(ss / N)} dBFS overall, ${dbf(vs / vn)} dBFS during speech; ${((100 * hot) / sp).toFixed(2)}% of speech samples reach the limiter knee`);
