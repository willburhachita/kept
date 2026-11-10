/**
 * Soundtrack for the demo video: everything synthesized here (no samples, no music from anywhere),
 * plus the Kokoro voiceover from out/vo. Writes out/soundtrack.wav (48 kHz, 16-bit stereo) and prints levels.
 *
 *   node video/sfx.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DURATION, SCENES, T, VO } from "./timeline.js";

const SR = 48000;
const N = Math.ceil(DURATION * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const bedL = new Float32Array(N), bedR = new Float32Array(N);
const voBus = new Float32Array(N);
const fxL = new Float32Array(N), fxR = new Float32Array(N); // effects, also fed to reverb

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const db = (d) => 10 ** (d / 20);

function add(t, buf, gain = 1, pan = 0) {
  const s0 = Math.round(t * SR);
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4), gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < buf.length; i++) {
    const j = s0 + i;
    if (j < 0 || j >= N) continue;
    fxL[j] += buf[i] * gl;
    fxR[j] += buf[i] * gr;
  }
}
const gen = (dur, f) => { const n = Math.round(dur * SR), b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = f(i / SR, i / n); return b; };
function lowpass(b, fc) { const a = 1 - Math.exp((-2 * Math.PI * fc) / SR); let y = 0; for (let i = 0; i < b.length; i++) b[i] = y += a * (b[i] - y); return b; }
function highpass(b, fc) { const a = Math.exp((-2 * Math.PI * fc) / SR); let px = 0, py = 0; for (let i = 0; i < b.length; i++) { const x = b[i]; py = a * (py + x - px); px = x; b[i] = py; } return b; }
function bandSweep(b, f0, f1, q = 4) {
  // state-variable band-pass with a swept center
  let lo = 0, bp = 0;
  for (let i = 0; i < b.length; i++) {
    const f = f0 * (f1 / f0) ** (i / b.length);
    const F = 2 * Math.sin((Math.PI * f) / SR), Q = 1 / q;
    const hi = b[i] - lo - Q * bp; bp += F * hi; lo += F * bp; b[i] = bp;
  }
  return b;
}

// ---- instruments
const pop = (f = 880) => gen(0.09, (t, p) => Math.sin(2 * Math.PI * (f * t - 1800 * t * t)) * Math.exp(-t * 45) * 0.8);
const click = () => highpass(gen(0.035, (t) => (rnd() * Math.exp(-t * 300) + Math.sin(2 * Math.PI * 3200 * t) * Math.exp(-t * 160) * 0.5)), 900);
const key = () => highpass(gen(0.02, (t) => rnd() * Math.exp(-t * 500) * 0.6), 2000);
const whoosh = (dur = 0.55, up = true) => { const b = gen(dur, (t, p) => rnd() * Math.sin(Math.PI * p) ** 2); return bandSweep(b, up ? 300 : 3000, up ? 3500 : 250, 2.5); };
const riser = (dur) => { const n = gen(dur, (t, p) => rnd() * p ** 2 * 0.6); bandSweep(n, 200, 6000, 3); const s = gen(dur, (t, p) => Math.sin(2 * Math.PI * (110 * t + 300 * t * t / dur)) * p ** 3 * 0.25); for (let i = 0; i < n.length; i++) n[i] += s[i]; return n; };
const sub = (f0 = 62) => { let ph = 0; return gen(1.6, (t) => { const f = f0 * Math.exp(-t * 1.1) + 28; ph += (2 * Math.PI * f) / SR; return (Math.sin(ph) * Math.exp(-t * 2.2) + (t < 0.006 ? rnd() * 0.6 : 0)) * 1.0; }); };
const clunk = () => { const a = gen(0.5, (t) => Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t * 14) * 0.9 + Math.sin(2 * Math.PI * 1310 * t) * Math.exp(-t * 40) * 0.2 + Math.sin(2 * Math.PI * 2120 * t) * Math.exp(-t * 55) * 0.15); return a; };
const bell = (f) => gen(2.4, (t) => (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 3) + 0.25 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t * 6)) * Math.exp(-t * 2.4) * 0.35);
const thunk = () => lowpass(gen(0.22, (t) => Math.sign(Math.sin(2 * Math.PI * 92 * t)) * Math.exp(-t * 18) * 0.7), 900);
const glitch = (dur = 0.28) => { let hold = 0, v = 0; return gen(dur, (t, p) => { if (hold-- <= 0) { hold = 40 + Math.floor(Math.abs(rnd()) * 400); v = rnd(); } return v * (Math.sin(2 * Math.PI * 37 * t) > -0.2 ? 1 : 0) * 0.5 * (1 - p); }); };
const tick = () => highpass(gen(0.012, (t) => rnd() * Math.exp(-t * 700)), 3000);

// ---- bed: a low pad that changes chord per scene, plus filtered air
const CHORDS = { cold: [55, 82.4, 110], title: [65.4, 98, 130.8, 196], say: [73.4, 110, 146.8, 220], graph: [61.7, 92.5, 123.5], counter: [58.3, 87.3, 116.5], proved: [65.4, 98, 130.8, 164.8], hold: [55, 82.4, 110, 164.8], keep: [73.4, 110, 146.8, 185], cheat: [51.9, 77.8, 103.8], agents: [61.7, 92.5, 123.5, 185], close: [65.4, 98, 130.8, 196] };
{
  const phases = new Float64Array(8);
  let air = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const sc = SCENES.find((s) => t >= s.start && t < s.end) ?? SCENES[SCENES.length - 1];
    const prev = SCENES[SCENES.indexOf(sc) - 1];
    const x = Math.min(1, (t - sc.start) / 1.2);
    const chordA = CHORDS[sc.id], chordB = prev ? CHORDS[prev.id] : chordA;
    let v = 0;
    for (let k = 0; k < 4; k++) {
      const f = (chordA[k] ?? chordA[0] * 2) * x + (chordB[k] ?? chordB[0] * 2) * (1 - x);
      phases[k] += (2 * Math.PI * f) / SR;
      v += Math.sin(phases[k] + 0.3 * Math.sin(phases[k] * 0.5)) * (k === 0 ? 0.5 : 0.28) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.13 * t + k));
    }
    air += 0.02 * (rnd() - air);
    let g = 1;
    if (sc.id === "cold" && t > T.coldOut - 2.2) g = Math.max(0, 1 - (t - (T.coldOut - 2.2)) / 1.4); // drop out before the title
    if (t >= T.silence && t < T.endLogo) g = 0; // silence before the logo
    if (t > DURATION - 3) g *= Math.max(0, (DURATION - t) / 3);
    const s = (v * 0.16 + air * 0.5) * g;
    bedL[i] = s * (1 + 0.15 * Math.sin(2 * Math.PI * 0.07 * t));
    bedR[i] = s * (1 - 0.15 * Math.sin(2 * Math.PI * 0.07 * t));
  }
}

// ---- voiceover
function readWav(path) {
  const b = readFileSync(path);
  let o = 12, fmt = null, data = null;
  while (o < b.length) { const id = b.toString("ascii", o, o + 4), sz = b.readUInt32LE(o + 4); if (id === "fmt ") fmt = { ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) }; if (id === "data") data = b.subarray(o + 8, o + 8 + sz); o += 8 + sz + (sz & 1); }
  if (!fmt || fmt.bits !== 16) throw new Error(`${path}: need 16-bit PCM`);
  const n = data.length / 2 / fmt.ch, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data.readInt16LE(i * 2 * fmt.ch) / 32768;
  return { s: out, sr: fmt.sr };
}
const voIndex = JSON.parse(readFileSync(new URL("./out/vo/index.json", import.meta.url)));
const voSpans = [];
{
  const ids = Object.keys(VO).sort((a, b) => VO[a] - VO[b]);
  for (let k = 0; k < ids.length; k++) {
    const id = ids[k], meta = voIndex.lines.find((l) => l.id === id);
    if (!meta) throw new Error(`no VO line ${id}`);
    const end = VO[id] + meta.dur, next = VO[ids[k + 1]];
    if (next !== undefined && end > next - 0.2) throw new Error(`VO ${id} ends at ${end.toFixed(2)} but ${ids[k + 1]} starts at ${next}`);
    voSpans.push([VO[id], end]);
    const { s, sr } = readWav(new URL(`./out/vo/${id}.wav`, import.meta.url));
    const n = Math.round((s.length * SR) / sr), s0 = Math.round(VO[id] * SR);
    for (let i = 0; i < n; i++) { const x = (i * sr) / SR, a = Math.floor(x), f = x - a; const v = (s[a] ?? 0) * (1 - f) + (s[a + 1] ?? 0) * f; if (s0 + i < N) voBus[s0 + i] += v; }
  }
  // gentle presence: high-pass rumble, normalize speech to a fixed peak
  highpass(voBus, 80);
  // compressor: 4:1 above -24 dB (relative to the line's peak), 5 ms attack, 120 ms release
  { let p0 = 0; for (const v of voBus) p0 = Math.max(p0, Math.abs(v)); let env = 0; const thr = p0 * db(-24), at = 1 - Math.exp(-1 / (0.005 * SR)), rl = 1 - Math.exp(-1 / (0.12 * SR));
    for (let i = 0; i < N; i++) { const a = Math.abs(voBus[i]); env += (a > env ? at : rl) * (a - env); if (env > thr) voBus[i] *= (thr * (env / thr) ** 0.25) / env; } }
  let pk = 0; for (const v of voBus) pk = Math.max(pk, Math.abs(v));
  for (let i = 0; i < N; i++) voBus[i] *= db(-3) / pk;
}

// ---- effect cues (all onsets come from timeline T)
const cues = [];
const cue = (t, buf, gain = 1, pan = 0) => cues.push([t, buf, gain, pan]);
T.bubbles.forEach((t, i) => cue(t, pop(i % 2 ? 700 : 900), db(-8), i % 2 ? -0.4 : 0.4));
cue(T.dotLeave, whoosh(0.6), db(-10), 0.7);
cue(T.notDelivered, thunk(), db(-12));
cue(T.flip, whoosh(0.5, false), db(-11), -0.5);
cue(T.seen, thunk(), db(-12));
cue(T.line1, click(), db(-10)); cue(T.line2, click(), db(-10));
cue(T.dotReturn, riser(1.6), db(-11));
cue(T.logoHit, sub(), db(-3)); cue(T.logoHit, bell(392), db(-12)); cue(T.logoHit + 0.02, glitch(0.08), db(-20));
cue(T.sub, whoosh(0.4), db(-16), 0.3);
cue(T.screenIn, whoosh(0.7), db(-9), -0.3);
for (let t = T.typeStart; t < T.typeEnd; t += 0.045 + 0.03 * Math.abs(rnd())) cue(t, key(), db(-20 + 4 * rnd()), 0.1 * rnd());
T.wordSwap.forEach((t) => cue(t, click(), db(-14), 0.3));
cue(T.draft, whoosh(0.5), db(-12)); T.draftCards.forEach((t) => cue(t, pop(820), db(-11))); cue(T.draftRules, pop(1000), db(-13));
cue(T.graphRace - 0.5, whoosh(0.6), db(-10));
for (let k = 0, t = T.graphRace; t < T.graphDone; k++, t += Math.max(0.035, 0.16 * Math.exp(-k / 20))) cue(t, tick(), db(-15 - 6 * Math.abs(rnd())), rnd() * 0.6);
cue(T.graphDone, bell(523), db(-14));
cue(T.counterHit, sub(55), db(-6)); cue(T.counterHit, glitch(0.3), db(-14));
T.steps.forEach((t) => cue(t, pop(760), db(-11)));
cue(T.badHit, thunk(), db(-6)); cue(T.badHit, glitch(0.4), db(-12));
cue(T.provedHit - 1.6, riser(1.6), db(-10)); cue(T.provedHit, sub(), db(-4)); cue(T.provedHit, bell(523), db(-12)); cue(T.provedHit + 0.12, bell(784), db(-16));
cue(T.fpSlide, whoosh(0.5), db(-11), -0.4); cue(T.fpClick, click(), db(-6)); cue(T.fpClick, bell(659), db(-16));
cue(T.simIn, whoosh(0.6), db(-11), 0.4); cue(T.simClick, click(), db(-8)); cue(T.holdDrop, whoosh(0.4, false), db(-12)); cue(T.holdDrop + 0.35, clunk(), db(-4));
cue(T.live, pop(900), db(-12));
cue(T.deliver, whoosh(0.5), db(-11)); cue(T.delivered, pop(880), db(-10)); cue(T.acceptClick, click(), db(-8));
[0, 0.18, 0.36, 0.6].forEach((d, i) => cue(T.settled + d, bell([523, 659, 784, 1046][i]), db(-13)));
cue(T.payout, whoosh(0.8), db(-12), 0.6); cue(T.certZoom, whoosh(0.5), db(-13));
cue(T.cheatTitle, sub(48), db(-7)); cue(T.gridIn, whoosh(0.6), db(-11));
cue(T.cellClick, click(), db(-9)); cue(T.cellClick + 0.15, click(), db(-11));
for (let i = 0; i < 4; i++) cue(T.typing + i * 0.14, key(), db(-14));
cue(T.broken, glitch(0.35), db(-6)); cue(T.broken, thunk(), db(-8)); cue(T.broken + 0.35, glitch(0.2), db(-10));
cue(T.coverClick, click(), db(-8)); cue(T.broken2, glitch(0.35), db(-6)); cue(T.broken2 + 0.3, glitch(0.25), db(-9));
cue(T.notUs, sub(52), db(-6));
cue(T.agentTitle, whoosh(0.6), db(-10)); cue(T.terminal, whoosh(0.5), db(-12));
T.calls.forEach((t, i) => { cue(t, key(), db(-12)); cue(t + 0.45, i === 0 ? bell(784) : i === 1 ? pop(660) : thunk(), i < 2 ? db(-12) : db(-8)); });
cue(T.console, whoosh(0.5), db(-12)); cue(T.closed, clunk(), db(-8)); [0, 0.15, 0.3].forEach((d, i) => cue(T.closed + 0.3 + d, bell([659, 784, 1046][i]), db(-15)));
cue(T.backtest, whoosh(0.4), db(-14));
T.stacc.forEach((t, i) => { cue(t, sub(70 - i * 4), db(-7)); cue(t, click(), db(-9)); });
cue(T.endLogo, sub(), db(-2)); cue(T.endLogo, bell(392), db(-10)); cue(T.endLogo + 0.2, bell(587), db(-15));
for (const [t, b, g, p] of cues) add(t, b, g, p);

// ---- reverb on effects (two feedback combs per side + all-pass smear)
function reverb(src, delays, fb, mix) {
  const out = new Float32Array(N);
  for (const d of delays) { const D = Math.round(d * SR); const buf = new Float32Array(N); for (let i = 0; i < N; i++) { buf[i] = src[i] + (i >= D ? buf[i - D] * fb : 0); out[i] += buf[i] * mix / delays.length; } }
  lowpass(out, 5000);
  return out;
}
const rvL = reverb(fxL, [0.0297, 0.0371, 0.0411, 0.0437], 0.78, 0.5), rvR = reverb(fxR, [0.0313, 0.0359, 0.0423, 0.0451], 0.78, 0.5);

// ---- mix: duck bed and effects reverb under the voice
const duck = new Float32Array(N);
{ let env = 0; for (let i = 0; i < N; i++) { const a = Math.abs(voBus[i]); env = a > env ? env + 0.01 * (a - env) : env + 0.00004 * (a - env); duck[i] = 1 - Math.min(0.55, env * 2.2); } }
for (let i = 0; i < N; i++) {
  const bed = db(-7) * duck[i];
  L[i] = bedL[i] * bed + fxL[i] * 0.85 + rvL[i] * 0.35 * duck[i] + voBus[i];
  R[i] = bedR[i] * bed + fxR[i] * 0.85 + rvR[i] * 0.35 * duck[i] + voBus[i];
}
// soft-clip limiter, then normalize peak to -1 dBFS
const DRIVE = 3;
{ let p = 0; for (let i = 0; i < N; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i])); for (let i = 0; i < N; i++) { L[i] /= p; R[i] /= p; } }
let hot = 0, sp = 0;
for (let i = 0; i < N; i++) { const t = i / SR; if (voSpans.some(([a, b]) => t >= a && t < b)) { sp++; if (Math.abs(L[i]) * DRIVE > 1.2) hot++; } }
console.log(`speech samples driven past the knee: ${((100 * hot) / sp).toFixed(2)}%`);
let pk = 0;
for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i] * DRIVE) / DRIVE; R[i] = Math.tanh(R[i] * DRIVE) / DRIVE; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
const g = db(-1) / pk;
let ss = 0, vs = 0, vn = 0;
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  const l = L[i] * g, r = R[i] * g; ss += (l * l + r * r) / 2;
  const t = i / SR; if (voSpans.some(([a, b]) => t >= a && t < b)) { vs += (l * l + r * r) / 2; vn++; }
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l)) * 32767), i * 4);
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r)) * 32767), i * 4 + 2);
}
const hdr = Buffer.alloc(44);
hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write("WAVEfmt ", 8); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22);
hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write("data", 36); hdr.writeUInt32LE(pcm.length, 40);
writeFileSync(new URL("./out/soundtrack.wav", import.meta.url), Buffer.concat([hdr, pcm]));
const dbf = (x) => (10 * Math.log10(x)).toFixed(1);
console.log(`soundtrack.wav ${DURATION}s, ${cues.length} effect cues, ${voSpans.length} VO lines; peak -1.0 dBFS, RMS ${dbf(ss / N)} dBFS overall, ${dbf(vs / vn)} dBFS during speech`);
