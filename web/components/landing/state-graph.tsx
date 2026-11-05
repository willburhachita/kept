/**
 * Decorative "every possible outcome" graph for dark panels: layers of states
 * fanning out left to right, with one highlighted path (the proved one).
 * Deterministic, so server and client render the same SVG.
 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Node {
  x: number;
  y: number;
}

function build(seed: number) {
  const r = rng(seed);
  const layers: Node[][] = [];
  const cols = 14;
  for (let i = 0; i < cols; i++) {
    const count = Math.min(2 + Math.round(i * 1.4 + r() * 2), 16);
    const layer: Node[] = [];
    for (let j = 0; j < count; j++) {
      const spread = 120 + i * 52;
      const y = 450 - spread / 2 + (spread * (j + 0.5)) / count + (r() - 0.5) * 18;
      layer.push({ x: 90 + i * 100 + (r() - 0.5) * 20, y });
    }
    layers.push(layer);
  }
  const edges: [Node, Node][] = [];
  for (let i = 0; i < layers.length - 1; i++) {
    for (const n of layers[i]!) {
      const next = layers[i + 1]!;
      const k = 1 + Math.floor(r() * 3);
      for (let e = 0; e < k; e++) edges.push([n, next[Math.floor(r() * next.length)]!]);
    }
  }
  // One proved path through the middle.
  const path = layers.map((l) => l[Math.floor(l.length / 2)]!);
  return { layers, edges, path };
}

export function StateGraph({ className, seed = 7 }: { className?: string; seed?: number }) {
  const { layers, edges, path } = build(seed);
  const d = path.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="sg-fade" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.05" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.05" />
        </linearGradient>
        <radialGradient id="sg-glow" cx="0.72" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#0066f5" stopOpacity="0.35" />
          <stop offset="1" stopColor="#0066f5" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1440" height="900" fill="url(#sg-glow)" />
      <g stroke="url(#sg-fade)" strokeWidth="1">
        {edges.map(([a, b], i) => (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        ))}
      </g>
      <g fill="#fff">
        {layers.flat().map((n, i) => (
          <circle key={i} cx={n.x} cy={n.y} r={2.2} opacity={0.35} />
        ))}
      </g>
      <path d={d} fill="none" stroke="#60cdff" strokeWidth="1.6" strokeOpacity="0.85" />
      <g fill="#60cdff">
        {path.map((n, i) => (
          <circle key={i} cx={n.x} cy={n.y} r={3.4} />
        ))}
      </g>
    </svg>
  );
}
