/**
 * One source of truth for picture and sound, for both cuts of the film.
 *
 * Each scene is a list of beats: a number is a pause (seconds), a string is a voiceover line id
 * (out/vo/<id>.wav). A beat or scene marked "+" / ext: true is only in the extended cut.
 * buildTimeline() lays the beats end to end using the real line durations from out/vo/index.json,
 * so nothing waits on a hand-set gap. events() turns voice timings into named moments that
 * index.html (picture) and sfx.mjs (sound) both use.
 *
 *   cut "full":  everything (about 3:30)          cut "short": the submission cut, under 3:00 (the hackathon limit)
 */
export const FPS = 30;
/** Fill in the public site host for the end card (e.g. "kept.example"), or leave empty to show only GitHub. */
export const SITE = "";
export const GITHUB = "github.com/willburhachita/kept";

export const CHAPTER_LABELS = { problem: "Problem", say: "Say it", prove: "Prove it", hold: "Hold it", keep: "Keep it", cheat: "Try to cheat", agents: "Agents" };

export const SCENES = [
  { id: "cold", ch: "problem", beats: ["+0.35", "+p0", "+0.3", 0.35, "p1", 0.3, "p2", 0.3, "p3", 1.0] },
  { id: "title", ch: null, beats: [0.55, "t1", 0.45] },
  { id: "who", ch: "problem", beats: [0.1, "w1", 0.55] },
  { id: "say", ch: "say", beats: [0.15, "s1", 0.1, "s2", 0.35, "s3", 0.3, "s4", 0.8] },
  { id: "graph", ch: "prove", beats: [0.15, "v1", 0.25, "v2", 1.0] },
  { id: "counter", ch: "prove", beats: [0.2, "v3", 1.4] },
  { id: "proved", ch: "prove", beats: [0.2, "v4", 0.45, "v5", 1.1] },
  { id: "hold", ch: "hold", beats: [0.2, "h1", 0.35, "h2", 0.7] },
  { id: "money", ch: "hold", beats: [0.1, "f1", 0.6] },
  { id: "keep", ch: "keep", beats: [0.3, "k1", 0.5, "k2", 0.7, "k3", 0.7] },
  { id: "plumber", ch: "keep", beats: [0.2, "x1", 0.7] },
  { id: "receipts", ch: "cheat", beats: [0.2, "r1", 0.4] },
  { id: "cheat", ch: "cheat", beats: [0.1, "c1", 0.8, "c2", 0.7, "c3", 0.35, "c4", 1.2] },
  { id: "link", ch: "cheat", ext: true, beats: [0.2, "l1", 0.8] },
  { id: "agents", ch: "agents", beats: [0.2, "n1", 0.35, "a1", 0.45, "a2", 0.3, "a3", 0.7, "+g1", "+0.3", "b1", 0.4, "a4", 1.0] },
  { id: "dev", ch: "agents", ext: true, beats: [0.2, "d1", 0.4, "d2", 0.4, "t2", 0.7] },
  { id: "close", ch: null, beats: [0.3, "z1", 0.5, "e1", 1.6, "e2", 4.8] },
];

/** Lays out a cut. index: the parsed out/vo/index.json. */
export function buildTimeline(index, cut = "full") {
  const lines = Object.fromEntries(index.lines.map((l) => [l.id, l]));
  const vo = {}, scenes = [];
  let t = 0;
  for (const sc of SCENES) {
    if (sc.ext && cut !== "full") continue;
    const start = t;
    for (let b of sc.beats) {
      if (typeof b === "string" && b.startsWith("+")) { if (cut !== "full") continue; b = b.slice(1); }
      if (typeof b === "number" || !Number.isNaN(Number(b))) { t += Number(b); continue; }
      const l = lines[b];
      if (!l) throw new Error(`no voiceover line "${b}" (run vo.py)`);
      // phrase starts: keep them increasing and inside the line, else fall back to character share
      const chars = l.phrases.map((p) => p.text.length), total = chars.reduce((a, c) => a + c, 0);
      const ph = [];
      l.phrases.forEach((p, i) => {
        const share = (l.dur * chars.slice(0, i).reduce((a, c) => a + c, 0)) / total;
        let x = p.t;
        if (i > 0 && (x <= ph[i - 1] - t + 0.12 || x > l.dur - 0.2)) x = share;
        ph.push(t + x);
      });
      vo[b] = { start: t, dur: l.dur, end: t + l.dur, ph };
      t += l.dur;
    }
    scenes.push({ id: sc.id, ch: sc.ch, start, end: t });
  }
  const chapters = [];
  for (const s of scenes) if (s.ch && chapters.at(-1)?.ch !== s.ch) chapters.push({ ch: s.ch, label: CHAPTER_LABELS[s.ch], start: s.start });
  const tl = { cut, duration: Math.ceil(t * FPS) / FPS, scenes, vo, chapters };
  tl.ev = events(tl);
  return tl;
}

/** Named moments per scene, from the voice timings. Shared by picture and sound. */
export function events(tl) {
  const V = (id) => tl.vo[id]?.start ?? null, E = (id) => tl.vo[id]?.end ?? null, P = (id, k) => tl.vo[id]?.ph[k] ?? null;
  const S = (id) => tl.scenes.find((s) => s.id === id);
  const ev = {};
  const on = (id, f) => { const s = S(id); if (s) ev[id] = f(s); };
  on("cold", (s) => {
    const a = V("p1");
    return {
      anyUpdate: V("p0") !== null ? [0, 1, 2, 3].map((i) => P("p0", 2) - 0.3 + i * 0.32) : [],
      bubbles: [a + 0.05, a + 0.45, a + 0.85], dotLeave: a + 1.0, read: P("p1", 1) + 0.9,
      flip: P("p2", 0), logoBubble: P("p2", 1) + 0.1, poof: P("p2", 2) + 1.1, lastSeen: P("p2", 2) + 1.6,
      line1: P("p3", 0), line2: P("p3", 1), out: s.end - 0.9, dotReturn: s.end - 0.75,
    };
  });
  on("title", (s) => ({ hit: s.start, sub: P("t1", 1) }));
  on("who", (s) => ({ swaps: [P("w1", 0) + 0.1, P("w1", 1), P("w1", 2)], friday: P("w1", 3), fridayBubble: P("w1", 4) - 0.1, dots: P("w1", 4) + 0.9 }));
  on("say", (s) => ({ screenIn: s.start, zoom: V("s1") + 0.4, typeStart: V("s2"), typeEnd: E("s2") - 0.15, send: E("s2") + 0.1, draft: V("s3"), cards: [P("s3", 0) + 0.7, P("s3", 1)], rules: P("s3", 1) + 0.6, scam: V("s4"), scamFlag: P("s4", 2) - 0.1, out: s.end }));
  on("graph", (s) => ({ proves: P("v1", 1), race: V("v2"), raceEnd: P("v2", 3) + 0.2, count: P("v2", 3), ms: P("v2", 4) + 0.2, out: s.end }));
  on("counter", (s) => ({ hit: V("v3") + 0.05, steps: [P("v3", 1), P("v3", 1) + 0.8, P("v3", 2)], bad: P("v3", 2) + 1.5, out: s.end }));
  on("proved", (s) => ({ repair: V("v4") + 0.2, never: P("v4", 1), hit: P("v4", 2), endings: V("v5"), out: s.end }));
  on("hold", (s) => ({ slide: V("h1") + 0.2, click: P("h1", 1), read: P("h1", 2), simIn: V("h2") - 0.15, simClick: V("h2") + 0.9, drop: V("h2") + 1.3, stranger: P("h2", 1), us: P("h2", 2), joke: P("h2", 3), live: P("h2", 3) + 0.3, out: s.end }));
  on("money", (s) => ({ auth: P("f1", 1), capture: P("f1", 2), voidT: P("f1", 3), out: s.end }));
  on("keep", (s) => ({ deliverClick: V("k1") + 0.55, delivered: V("k1") + 0.85, acceptClick: P("k1", 1) + 0.75, settled: V("k2"), phone: P("k2", 2), toasts: [P("k2", 2) + 0.3, P("k2", 2) + 0.75, P("k2", 2) + 1.2], fee: P("k3", 1), out: s.end }));
  on("plumber", (s) => ({ card: V("x1") + 0.1, fee40: P("x1", 2), rest: P("x1", 3), noshow: P("x1", 4), home: P("x1", 5), out: s.end }));
  on("receipts", (s) => ({ chain: V("r1"), browser: P("r1", 1), noacct: P("r1", 2), out: s.end }));
  on("cheat", (s) => ({ title: V("c1") + 0.95, gridIn: E("c1") + 0.35, click: V("c2") + 0.15, typing: V("c2") + 0.5, broken: P("c2", 3) - 0.05, cover: V("c3") + 0.5, broken2: P("c3", 1) + 0.05, truth: P("c3", 3), notUs: V("c4") - 0.1, out: s.end }));
  on("link", (s) => ({ type: P("l1", 1) - 0.3, click: P("l1", 2) - 0.1, result: P("l1", 2) + 0.2, out: s.end }));
  on("agents", (s) => {
    const a2 = (k) => P("a2", k), a3 = (k) => P("a3", k);
    return {
      hook: V("n1"), title: V("a1"), terminal: E("a1") + 0.15,
      calls: [[a2(0), a2(1)], [a2(2), Math.max(a2(2) + 0.45, a2(3) + 0.6)], [a2(4), a2(5)], [a3(0), a3(1)], [a3(2), a3(3)]],
      robot: a2(6), feed: V("g1"), backtest: V("b1"), bt20: P("b1", 2), blocked: P("b1", 3), closed: V("a4"), home: P("a4", 1), out: s.end,
    };
  });
  on("dev", (s) => ({ docs: V("d1"), mcp: P("d1", 2), embed: V("d2"), stack: V("t2"), stackItems: [P("t2", 1), P("t2", 2), P("t2", 3), P("t2", 4)], out: s.end }));
  on("close", (s) => ({ pitch: V("z1"), stacc: [0, 1, 2, 3].map((k) => P("e1", k)), silence: E("e1") + 0.35, logo: V("e2"), end: s.end }));
  return ev;
}
