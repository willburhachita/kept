/**
 * Renders the film: serves video/ locally, steps render(t) in headless Chromium (Playwright), screenshots
 * every frame and pipes them with out/soundtrack.wav into ffmpeg (H.264 + AAC, faststart MP4).
 * Uses the Chromium and ffmpeg already installed on the machine; nothing is downloaded.
 *
 *   node video/render.mjs --cut short         submission cut (< 3:00) -> video/release/kept-demo.mp4
 *   node video/render.mjs --cut full          extended cut           -> video/release/kept-demo-extended.mp4
 *   node video/render.mjs --cut full --stills 3,16.5,40   review frames -> video/out/stills/*.jpg
 *   node video/render.mjs --cut full --from 90 --to 111   a section     -> video/out/section.mp4
 * Build the matching soundtrack first: node video/sfx.mjs <cut>.
 *
 * Env: KEPT_CHROME (optional Chromium path), FFMPEG (default "ffmpeg"), WORKERS (parallel pages, default 4).
 */
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = join(HERE, "out");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".woff2": "font/woff2", ".jpg": "image/jpeg", ".png": "image/png" };
const ALLOWED = ["video/", "node_modules/@fontsource-variable/"];

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const WORKERS = Number(process.env.WORKERS ?? 4);
const CUT = opt("cut") ?? "full";
if (!["short", "full"].includes(CUT)) throw new Error("--cut must be short or full");

const server = createServer((req, res) => {
  const rel = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^[\\/]+/, "").replace(/\\/g, "/");
  const file = join(ROOT, rel);
  if (!ALLOWED.some((a) => rel.startsWith(a)) || !existsSync(file) || statSync(file).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL0 = `http://127.0.0.1:${server.address().port}/video/index.html?cut=${CUT}`;

const browser = await chromium.launch({ executablePath: process.env.KEPT_CHROME || undefined });
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
  await page.goto(URL0, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  return page;
}
const frame = async (page, t) => { await page.evaluate((t) => window.render(t), t); return page.screenshot({ type: "jpeg", quality: 93 }); };

try {
  if (opt("stills")) {
    mkdirSync(join(OUT, "stills"), { recursive: true });
    const page = await openPage();
    for (const t of opt("stills").split(",").map(Number)) { writeFileSync(join(OUT, "stills", `${CUT}-t${t.toFixed(2).padStart(6, "0")}.jpg`), await frame(page, t)); }
    console.log("stills written to video/out/stills");
  } else {
    const page0 = await openPage();
    const fps = await page0.evaluate(() => window.FPS), total = await page0.evaluate(() => window.FRAMES);
    const from = Math.round(Number(opt("from") ?? 0) * fps), to = Math.min(total, Math.round(Number(opt("to") ?? total / fps) * fps));
    const section = opt("from") !== undefined || opt("to") !== undefined;
    const out = section ? join(OUT, "section.mp4") : join(HERE, "release", CUT === "short" ? "kept-demo.mp4" : "kept-demo-extended.mp4");
    mkdirSync(dirname(out), { recursive: true });
    if (existsSync(out)) unlinkSync(out);
    const ff = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
      "-ss", String(from / fps), "-i", join(OUT, `soundtrack-${CUT}.wav`),
      "-map", "0:v", "-map", "1:a", "-shortest",
      "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-maxrate", "4500k", "-bufsize", "9000k", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1", "-r", String(fps), "-g", String(fps * 2),
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((r, j) => ff.on("close", (c) => (c === 0 ? r() : j(new Error(`ffmpeg exited ${c}`)))));
    // parallel pages render ahead; frames are written to ffmpeg strictly in order
    const pages = [page0, ...(await Promise.all(Array.from({ length: WORKERS - 1 }, openPage)))];
    const pending = new Map(); let next = from, written = from; const t0 = Date.now();
    const write = (buf) => new Promise((r) => (ff.stdin.write(buf) ? r() : ff.stdin.once("drain", r)));
    await Promise.all(pages.map(async (p) => {
      while (next < to) {
        const i = next++;
        pending.set(i, await frame(p, i / fps));
        while (pending.has(written)) { const b = pending.get(written); pending.delete(written); written++; await write(b); }
        if (i % 150 === 0) console.log(`frame ${i}/${to}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        while (pending.size > 60) await new Promise((r) => setTimeout(r, 20));
      }
    }));
    ff.stdin.end(); await done;
    console.log(`wrote ${out} (${(statSync(out).size / 1048576).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
} finally {
  await browser.close(); server.close();
}
