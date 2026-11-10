/**
 * Local studio for the demo video: a small static server plus headless Chrome.
 * Chrome does the rendering and H.264 encoding, so nothing else needs installing.
 *
 *   node video/studio.mjs serve               preview at http://localhost:4599/video/index.html
 *   node video/studio.mjs run <page> [query]  open a page headlessly until it POSTs /done
 */
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = join(HERE, "out");
const PORT = 4599;
// Chrome/Chromium binary: KEPT_CHROME wins, else the usual install path for this platform.
const CHROME =
  process.env.KEPT_CHROME ||
  (process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/opt/pw-browsers/chromium"].find((p) => existsSync(p)) ?? "google-chrome");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".woff2": "font/woff2", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".wav": "audio/wav", ".mp4": "video/mp4" };
const ALLOWED = ["video/", "node_modules/@fontsource-variable/", "web/assets/photos/"];
// Reference clips the user supplied, by index: read only, used for style analysis.
const REFS = (process.env.KEPT_REFS ?? "").split("|").filter(Boolean);

mkdirSync(OUT, { recursive: true });
let finish = () => {};
const finished = new Promise((r) => (finish = r));

function sendFile(req, res, path) {
  const size = statSync(path).size;
  const type = MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    createReadStream(path, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": size, "cache-control": "no-store" });
  createReadStream(path).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === "POST") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      if (url.pathname.startsWith("/save/")) {
        const name = url.pathname.slice(6).replace(/[^\w.\-]/g, "_");
        writeFileSync(join(OUT, name), body);
        console.log(`saved ${name} (${(body.length / 1048576).toFixed(1)} MB)`);
      } else if (url.pathname === "/log") {
        console.log(body.toString());
      } else if (url.pathname === "/done") {
        console.log(body.toString() || "done");
        finish();
      }
      res.writeHead(204).end();
    });
    return;
  }
  const ref = /^\/ref\/(\d+)$/.exec(url.pathname);
  if (ref) {
    const p = REFS[Number(ref[1])];
    if (!p || !existsSync(p)) return void res.writeHead(404).end();
    return sendFile(req, res, p);
  }
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, "").replace(/\\/g, "/");
  const file = join(ROOT, rel);
  if (!ALLOWED.some((a) => rel.startsWith(a)) || !existsSync(file) || statSync(file).isDirectory()) return void res.writeHead(404).end();
  sendFile(req, res, file);
});

const [mode, page, query = ""] = process.argv.slice(2);
server.listen(PORT, "127.0.0.1", async () => {
  if (mode !== "run") return console.log(`studio on http://localhost:${PORT}/video/index.html`);
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--user-data-dir=${join(process.env.KEPT_CHROME_DIR ?? tmpdir(), "kept-studio-chrome")}`,
      "--autoplay-policy=no-user-gesture-required",
      "--force-device-scale-factor=1",
      "--window-size=1920,1080",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      `http://localhost:${PORT}/video/${page}${query ? `?${query}` : ""}`,
    ],
    { stdio: "ignore" },
  );
  await finished;
  chrome.kill();
  server.close();
  process.exit(0);
});
