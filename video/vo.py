"""
Voiceover for the demo video, synthesized locally with Kokoro (open weights, Apache-2.0).

  KOKORO_DIR=/path/with/kokoro-v1.0.onnx+voices-v1.0.bin  python vo.py [voice]

Writes out/vo/<id>.wav (24 kHz mono) for every line in vo.json and out/vo/index.json with each
line's duration and the start of every phrase (split at . , ? !), which timeline.js uses to hit
words exactly. Long pauses the voice leaves at full stops are shortened, so the delivery stays brisk.
Swap the voice by passing a name (af_heart, af_bella, bf_emma, af_nicole ...).
"""
import json, os, re, sys
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
cfg = json.load(open(os.path.join(HERE, "vo.json")))
voice = sys.argv[1] if len(sys.argv) > 1 else cfg["voice"]
only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None
mdir = os.environ.get("KOKORO_DIR", ".")
k = Kokoro(os.path.join(mdir, "kokoro-v1.0.onnx"), os.path.join(mdir, "voices-v1.0.bin"))
out = os.path.join(HERE, "out", "vo")
os.makedirs(out, exist_ok=True)
MAX_PAUSE, KEEP_PAUSE, THR = 0.20, 0.13, 0.012

def silent_runs(s, sr, min_len):
    win = int(0.01 * sr)
    n = len(s) // win
    quiet = [np.max(np.abs(s[i * win:(i + 1) * win])) < THR for i in range(n)]
    runs, i = [], 0
    while i < n:
        if quiet[i]:
            j = i
            while j < n and quiet[j]: j += 1
            if (j - i) * win >= min_len * sr: runs.append((i * win, j * win))
            i = j
        else: i += 1
    return runs

idx_path = os.path.join(out, "index.json")
old = {l["id"]: l for l in json.load(open(idx_path))["lines"]} if only and os.path.exists(idx_path) else {}
index = {"voice": voice, "speed": cfg["speed"], "lines": []}
for line in cfg["lines"]:
    if only and line["id"] not in only and line["id"] in old:
        index["lines"].append(old[line["id"]]); continue
    samples, sr = k.create(line["text"], voice=voice, speed=line.get("speed", cfg["speed"]), lang="en-us" if voice[0] == "a" else "en-gb")
    s = np.asarray(samples, dtype=np.float32)
    nz = np.where(np.abs(s) > THR)[0]
    if len(nz): s = s[max(0, nz[0] - int(0.03 * sr)): nz[-1] + int(0.08 * sr)]
    # shorten long interior pauses (with a short crossfade so nothing clicks)
    parts, last = [], 0
    for a, b in silent_runs(s, sr, MAX_PAUSE):
        if a == 0 or b >= len(s): continue
        keep = int(KEEP_PAUSE * sr)
        parts.append(s[last:a + keep // 2]); last = b - keep // 2
    parts.append(s[last:])
    s = np.concatenate(parts)
    # phrase starts: align text phrases to the pauses between them
    phrases = [p for p in re.split(r"(?<=[.,?!])\s+", line["text"]) if p]
    gaps = [((a + b) / 2) / sr for a, b in silent_runs(s, sr, 0.06) if a > 0 and b < len(s)]
    total = len(s) / sr
    chars = [len(p) for p in phrases]
    starts, used = [0.0], set()
    for i in range(1, len(phrases)):
        expect = total * sum(chars[:i]) / sum(chars)
        cand = [g for g in gaps if g > starts[-1] + 0.15 and g not in used]
        g = min(cand, key=lambda g: abs(g - expect)) if cand else expect
        if abs(g - expect) > 0.6: g = expect
        used.add(g); starts.append(round(g, 3))
    sf.write(os.path.join(out, line["id"] + ".wav"), s, sr, subtype="PCM_16")
    index["lines"].append({"id": line["id"], "dur": round(total, 3), "text": line["text"], "phrases": [{"t": t, "text": p} for t, p in zip(starts, phrases)]})
    print(f'{line["id"]}: {total:.2f}s  ' + " | ".join(f"{t:.2f} {p}" for t, p in zip(starts, phrases)))
json.dump(index, open(idx_path, "w"), indent=1)
print("total speech", round(sum(l["dur"] for l in index["lines"]), 1), "s")
