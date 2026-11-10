"""
Voiceover for the demo video, synthesized locally with Kokoro (open weights, Apache-2.0).

  KOKORO_DIR=/path/with/kokoro-v1.0.onnx+voices-v1.0.bin  python vo.py [voice]

Writes out/vo/<id>.wav (24 kHz mono) for every line in vo.json and out/vo/index.json
with each line's duration, which timeline.js uses to place picture and sound.
Swap the voice by passing a name (af_heart, af_bella, bf_emma, af_nicole ...).
"""
import json, os, sys
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
cfg = json.load(open(os.path.join(HERE, "vo.json")))
voice = sys.argv[1] if len(sys.argv) > 1 else cfg["voice"]
mdir = os.environ.get("KOKORO_DIR", ".")
k = Kokoro(os.path.join(mdir, "kokoro-v1.0.onnx"), os.path.join(mdir, "voices-v1.0.bin"))
out = os.path.join(HERE, "out", "vo")
os.makedirs(out, exist_ok=True)
index = {"voice": voice, "lines": []}
for line in cfg["lines"]:
    samples, sr = k.create(line["text"], voice=voice, speed=line.get("speed", cfg["speed"]), lang="en-us" if voice[0] == "a" else "en-gb")
    s = np.asarray(samples, dtype=np.float32)
    # trim leading/trailing near-silence so 'gap' alone controls breathing space
    nz = np.where(np.abs(s) > 0.01)[0]
    if len(nz):
        s = s[max(0, nz[0] - int(0.03 * sr)): nz[-1] + int(0.08 * sr)]
    sf.write(os.path.join(out, line["id"] + ".wav"), s, sr, subtype="PCM_16")
    index["lines"].append({"id": line["id"], "dur": round(len(s) / sr, 3), "gap": line["gap"], "text": line["text"]})
    print(f'{line["id"]}: {len(s) / sr:.2f}s  {line["text"]}')
json.dump(index, open(os.path.join(out, "index.json"), "w"), indent=1)
print("total speech", round(sum(l["dur"] for l in index["lines"]), 1), "s, with gaps", round(sum(l["dur"] + l["gap"] for l in index["lines"]), 1), "s")
