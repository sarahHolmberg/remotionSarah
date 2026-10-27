// server/server.mjs
// NEW FILE: the production server for Cloud Run (replaces the Vite dev server + `npx remotion render` from the Codespace)
//
// One Node process that:
//   1. serves the built editor + preview pages (dist/, made by `npm run app:build`)
//   2. offers the same /api/upload, /api/render, /api/download the dev server has (app/vite.config.ts)
//   3. renders with the Remotion bundle made once at build time (build/, made by `npm run bundle`)
// Everything is behind a password (env APP_PASSWORD, any username).
// Run locally:  APP_PASSWORD=test node server/server.mjs   (after app:build and bundle)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {renderMedia, selectComposition} from "@remotion/renderer"; // installed with @remotion/cli, same version

const ROOT = process.cwd(); // run from the repo root (the Dockerfile does)
const DIST = path.join(ROOT, "dist"); // the built pages
const BUNDLE = path.join(ROOT, "build"); // the Remotion bundle
const PUBLIC = path.join(BUNDLE, "public"); // staticFile() in the render reads from here, so uploads go here too
const OUT = path.join(ROOT, "out", "comic.mp4");
const PORT = Number(process.env.PORT || 8080); // Cloud Run sets PORT
const PASSWORD = process.env.APP_PASSWORD || "";
const CONCURRENCY = Number(process.env.RENDER_CONCURRENCY || 2); // 2 was the fastest on 2 CPUs in the Codespace test
let busy = false;

const log = (m) => console.log(`[Server] ${m}`);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".woff2": "font/woff2",
};

// Basic auth: the browser shows its own login box. Any username, the password must match.
const authorized = (req) => {
  if (!PASSWORD) return true;
  const m = /^Basic (.+)$/.exec(req.headers.authorization ?? "");
  if (!m) return false;
  const pass = Buffer.from(m[1], "base64").toString().split(":").slice(1).join(":");
  const a = crypto.createHash("sha256").update(pass).digest();
  const b = crypto.createHash("sha256").update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
};

// a file inside dir, or null if the path tries to leave it
const inside = (dir, urlPath) => {
  let f;
  try {
    f = path.join(dir, decodeURIComponent(urlPath));
  } catch {
    return null; // broken %-encoding
  }
  return f.startsWith(dir + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile() ? f : null;
};

// No Content-Length on purpose: a chunked response is not held to Cloud Run's 32 MB response limit
const sendFile = (res, f, extraHeaders = {}) => {
  res.writeHead(200, {"Content-Type": TYPES[path.extname(f).toLowerCase()] ?? "application/octet-stream", ...extraHeaders});
  fs.createReadStream(f).pipe(res);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

// 1. a piece of the video or picture. The browser sends files in pieces (Cloud Run refuses request bodies over 32 MB);
//    offset=0 starts the file, every next piece must start where the file ends now.
const upload = (req, res, url) => {
  const safe = path.basename(url.searchParams.get("name") ?? "video.mp4").replace(/[^A-Za-z0-9._-]/g, "_");
  const file = `export-input-${safe}`;
  const f = path.join(PUBLIC, file);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const size = fs.existsSync(f) ? fs.statSync(f).size : 0;
  if (offset > 0 && offset !== size) {
    log(`upload ${file}: piece at ${offset} but the file has ${size} bytes`);
    res.statusCode = 409;
    return res.end(`Upload pieces out of order: expected offset ${size}, got ${offset}.`);
  }
  const ws = fs.createWriteStream(f, {flags: offset > 0 ? "a" : "w"});
  req.pipe(ws);
  ws.on("finish", () => {
    log(`upload ${file}: ${ws.bytesWritten} bytes at ${offset}`);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({file}));
  });
  ws.on("error", (e) => {
    log(`upload ${file} failed: ${e.message}`);
    res.statusCode = 500;
    res.end(String(e));
  });
};

// 2. render the JSON, stream progress lines back. The request stays open for the whole render:
//    Cloud Run only gives the container CPU while a request is open.
const render = async (req, res) => {
  if (busy) {
    log("refused: a render is already running");
    res.statusCode = 409;
    return res.end("A render is already running, wait for it to finish.");
  }
  let spec;
  try {
    spec = JSON.parse(await readBody(req));
  } catch (e) {
    res.statusCode = 400;
    return res.end(`The JSON sent by the preview is not valid: ${e.message}`);
  }
  busy = true;
  res.writeHead(200, {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no"});
  const say = (l) => {
    log(`render: ${l}`);
    res.write(`${l}\n`);
  };
  const started = Date.now();
  try {
    say(`Starting: ComicEdit, concurrency ${CONCURRENCY}`);
    const composition = await selectComposition({serveUrl: BUNDLE, id: "ComicEdit", inputProps: spec});
    say(`Video: ${composition.width}x${composition.height}, ${composition.durationInFrames} frames at ${composition.fps} fps`);
    let lastPct = -1;
    await renderMedia({
      composition,
      serveUrl: BUNDLE,
      codec: "h264",
      imageFormat: "jpeg", // same as remotion.config.ts
      outputLocation: OUT,
      inputProps: spec,
      concurrency: CONCURRENCY,
      overwrite: true,
      onProgress: ({progress, renderedFrames, encodedFrames}) => {
        const pct = Math.floor(progress * 100);
        if (pct === lastPct || pct % 5 !== 0) return;
        lastPct = pct;
        say(`${pct}%  rendered ${renderedFrames}, encoded ${encodedFrames} of ${composition.durationInFrames} frames`);
      },
    });
    say(`Took ${((Date.now() - started) / 1000).toFixed(1)}s`);
    say("[RENDER DONE]");
  } catch (e) {
    say(`[RENDER FAILED] ${e?.message ?? e}`);
  } finally {
    busy = false;
    res.end();
  }
};

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (!authorized(req)) {
      res.writeHead(401, {"WWW-Authenticate": 'Basic realm="Comic editor"'});
      return res.end("Password needed.");
    }
    if (url.pathname.startsWith("/api/")) log(`${req.method} ${url.pathname}`);

    if (req.method === "GET" && url.pathname === "/api/version") {
      // K_REVISION is set by Cloud Run: the name of the deploy that serves this page (remotion-render-00004-abc)
      res.writeHead(200, {"Content-Type": "application/json", "Cache-Control": "no-cache"});
      return res.end(JSON.stringify({revision: process.env.K_REVISION ?? "local server"}));
    }
    if (req.method === "POST" && url.pathname === "/api/upload") return upload(req, res, url);
    if (req.method === "POST" && url.pathname === "/api/render") return void render(req, res);
    if (req.method === "GET" && url.pathname === "/api/download") {
      if (!fs.existsSync(OUT)) {
        res.statusCode = 404;
        return res.end("No exported video yet.");
      }
      return sendFile(res, OUT, {"Content-Disposition": 'attachment; filename="comic.mp4"'});
    }
    if (url.pathname.startsWith("/api/")) {
      res.statusCode = 404;
      return res.end("unknown endpoint");
    }

    // the pages, then the public files (the preview falls back to public/<video.file>, the sound mp3)
    if (req.method === "GET") {
      const f = inside(DIST, url.pathname === "/" ? "/index.html" : url.pathname) ?? inside(PUBLIC, url.pathname);
      if (f) return sendFile(res, f, f.endsWith(".html") ? {"Cache-Control": "no-cache"} : {}); // pages are always re-checked, so a new deploy shows right away
    }
    res.statusCode = 404;
    res.end("not found");
  })
  .listen(PORT, () => {
    fs.mkdirSync(PUBLIC, {recursive: true});
    fs.mkdirSync(path.dirname(OUT), {recursive: true});
    for (const [what, dir] of [["pages", DIST], ["Remotion bundle", BUNDLE]]) {
      if (!fs.existsSync(path.join(dir, "index.html"))) log(`WARNING: ${what} missing in ${dir} (run npm run app:build and npm run bundle)`);
    }
    log(`listening on port ${PORT}, password ${PASSWORD ? "on" : "OFF (set APP_PASSWORD)"}`);
  });
