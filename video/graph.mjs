/**
 * Exports the real state graph and verdicts of the demo deal for the video, so the big
 * "every possible path" animation draws the actual contract, not decoration.
 * Mirrors the search in packages/core/src/verifier.ts; the counts are checked against verify().
 *
 *   node video/graph.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_FEE_BPS, EXAMPLES, enabledEvents, formatCents, initialState, isTerminal, renderContract, step, verify } from "../packages/core/dist/index.js";

function explore(ir) {
  const idx = new Map(ir.clauses.map((c, i) => [c.id, i]));
  const keyOf = (s) => {
    let mask = 0;
    for (const id of s.fired) mask |= 1 << (idx.get(id) ?? 0);
    const ev = s.evidence.map((e) => `${e.status[0]}${e.before.length}`).join(",");
    return `${s.activated ? 1 : 0}${s.closed ? 1 : 0}|${s.passed.length}|${ev}|${mask}|${s.heldCents},${s.releasedCents},${s.refundedCents}`;
  };
  const root = initialState(ir);
  const nodes = new Map([[keyOf(root), { i: 0, s: root, depth: 0 }]]);
  const queue = [keyOf(root)];
  const edges = [];
  let transitions = 0;
  for (let q = 0; q < queue.length; q++) {
    const key = queue[q];
    const n = nodes.get(key);
    if (isTerminal(ir, n.s)) continue;
    for (const ev of enabledEvents(ir, n.s)) {
      const res = step(ir, n.s, ev);
      transitions++;
      if (res.faults.length) continue;
      const k = keyOf(res.state);
      if (!nodes.has(k)) {
        nodes.set(k, { i: nodes.size, s: res.state, depth: n.depth + 1 });
        queue.push(k);
      }
      edges.push([n.i, nodes.get(k).i]);
    }
  }
  return {
    transitions,
    nodes: [...nodes.values()].map((n) => ({ depth: n.depth, held: n.s.heldCents, released: n.s.releasedCents, refunded: n.s.refundedCents, end: isTerminal(ir, n.s) })),
    edges,
  };
}

function summarize(ir) {
  const report = verify(ir, { feeBps: DEFAULT_FEE_BPS });
  const g = explore(ir);
  if (g.nodes.length !== report.stats.states || g.transitions !== report.stats.transitions) throw new Error(`graph mismatch: ${g.nodes.length}/${report.stats.states} states, ${g.transitions}/${report.stats.transitions} transitions`);
  const bad = report.properties.find((p) => p.status === "violated" && p.severity === "error" && p.counterexample) ?? report.properties.find((p) => p.status === "violated" && p.counterexample);
  return {
    ok: report.ok,
    summary: report.summary,
    stats: report.stats,
    properties: report.properties.map((p) => ({ title: p.title, status: p.status, severity: p.severity, detail: p.detail })),
    violated: bad ? { title: bad.title, outcome: bad.counterexample.outcome, steps: bad.counterexample.steps.map((s) => ({ narration: s.narration, held: s.heldCents, released: s.releasedCents, refunded: s.refundedCents })) } : null,
    graph: g,
  };
}

const out = { naive: summarize(EXAMPLES.logoNaive), fixed: summarize(EXAMPLES.logoFixed), plumber: summarize(EXAMPLES.plumberDraft), rules: renderContract(EXAMPLES.logoFixed, { feeBps: DEFAULT_FEE_BPS }).rules ?? null, fmt: formatCents(30000, "USD") };
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/graph.json", import.meta.url), JSON.stringify(out));
for (const k of ["naive", "fixed", "plumber"]) console.log(k, out[k].summary, JSON.stringify({ states: out[k].graph.nodes.length, edges: out[k].graph.edges.length, ends: out[k].stats.terminalStates, depth: out[k].stats.maxDepth, ms: Math.round(out[k].stats.ms) }));
console.log("VIOLATED:", out.naive.violated?.title, "=>", out.naive.violated?.outcome);
for (const s of out.naive.violated?.steps ?? []) console.log("  -", s.narration.join(" "), JSON.stringify([s.held, s.released, s.refunded]));
