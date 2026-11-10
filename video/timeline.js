/**
 * One source of truth for picture and sound. Times in seconds.
 * Imported by index.html (picture) and sfx.mjs (soundtrack). VO durations come from out/vo/index.json;
 * sfx.mjs refuses to build if a line would overlap the next one.
 */
export const FPS = 30;
export const DURATION = 146;
/** Fill in the public site host for the end card (e.g. "kept.example"), or leave empty to show only GitHub. */
export const SITE = "";
export const GITHUB = "github.com/willburhachita/kept";

export const CHAPTERS = [
  { id: "problem", label: "Problem", start: 0 },
  { id: "say", label: "Say it", start: 22 },
  { id: "prove", label: "Prove it", start: 36 },
  { id: "hold", label: "Hold it", start: 63 },
  { id: "keep", label: "Keep it", start: 77 },
  { id: "cheat", label: "Try to cheat", start: 91 },
  { id: "agents", label: "Agents", start: 111 },
  { id: "close", label: "Kept", start: 133 },
];

export const SCENES = [
  { id: "cold", start: 0, end: 15 },
  { id: "title", start: 15, end: 22 },
  { id: "say", start: 22, end: 36 },
  { id: "graph", start: 36, end: 46 },
  { id: "counter", start: 46, end: 54 },
  { id: "proved", start: 54, end: 63 },
  { id: "hold", start: 63, end: 77 },
  { id: "keep", start: 77, end: 91 },
  { id: "cheat", start: 91, end: 111 },
  { id: "agents", start: 111, end: 133 },
  { id: "close", start: 133, end: 146 },
];

/** Voiceover placement (line id -> start). */
export const VO = {
  p1: 1.0, p2: 5.2, p3: 10.2,
  t1: 16.4,
  s1: 23.0, s2: 30.2,
  v1: 37.0, v2: 46.6, v3: 55.2,
  h1: 63.6, h2: 68.6,
  k1: 78.0, k2: 83.4,
  c1: 91.8, c2: 96.4, c3: 103.6,
  a1: 111.6, a2: 117.2, a3: 125.8,
  e1: 133.4, e2: 138.6,
};

/** Key moments shared by picture and sound. */
export const T = {
  // cold open
  bubbles: [0.3, 0.9, 1.5, 3.0, 3.5, 5.2, 5.8, 6.7, 7.3],
  dotLeave: 1.8, notDelivered: 4.0, flip: 4.6, seen: 7.9,
  line1: 10.2, line2: 11.2, coldOut: 13.6, dotReturn: 14.0,
  // title
  logoHit: 15.6, sub: 17.0,
  // say it
  screenIn: 22.2, typeStart: 24.4, typeEnd: 29.0, wordSwap: [24.0, 25.6, 27.2], draft: 30.2, draftCards: [31.4, 32.4], draftRules: 33.4,
  // prove
  graphRace: 37.4, graphDone: 44.6, counterHit: 47.0, steps: [48.6, 50.0, 51.4], badHit: 52.6, provedHit: 57.6,
  // hold
  fpSlide: 64.0, fpClick: 65.4, simIn: 67.0, simClick: 70.4, holdDrop: 71.0, live: 72.6,
  // keep
  deliver: 77.6, delivered: 79.0, acceptClick: 81.8, settled: 83.0, payout: 83.6, certZoom: 86.2,
  // cheat
  cheatTitle: 91.0, gridIn: 93.2, cellClick: 94.6, typing: 95.2, broken: 96.6, coverClick: 100.6, broken2: 102.6, notUs: 105.4,
  // agents
  agentTitle: 111.0, terminal: 115.6, calls: [117.2, 118.6, 120.3, 122.0, 123.5], console: 125.0, closed: 126.6, backtest: 129.6,
  // close
  stacc: [133.4, 133.9, 134.45, 135.0], silence: 136.6, endLogo: 138.6,
};
