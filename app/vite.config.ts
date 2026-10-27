// app/vite.config.ts
// NOT NEW: existing file, changed (uploads arrive in pieces; build settings for the Cloud Run server)

import {defineConfig, type Plugin} from "vite";
import react from "@vitejs/plugin-react";
import {spawn} from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd(); // run `npm run app` from the repo root
const PROPS = "scripts/export.json"; // the JSON the render reads (your own scripts/edit.json is not touched)
const OUT = "out/comic.mp4";
let busy = false;

const log = (m: string) => console.log(`[RenderApi] ${m}`);

// Dev-server endpoints. The preview tab calls them; nothing here is used by the Remotion render itself.
const renderApi = (): Plugin => ({
  name: "render-api",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url ?? "", "http://x");
      if (!url.pathname.startsWith("/api/")) return next();
      log(`${req.method} ${url.pathname}`);

      // 1. the video picked in tab 1 (it only lives in the browser) -> public/, so the render can read it
      if (req.method === "POST" && url.pathname === "/api/upload") {
        const safe = path.basename(url.searchParams.get("name") ?? "video.mp4").replace(/[^A-Za-z0-9._-]/g, "_");
        const file = `export-input-${safe}`;
        const offset = Number(url.searchParams.get("offset") ?? 0); // the preview sends files in pieces: 0 starts the file, the rest are appended
        fs.mkdirSync(path.join(ROOT, "public"), {recursive: true});
        const ws = fs.createWriteStream(path.join(ROOT, "public", file), {flags: offset > 0 ? "a" : "w"});
        req.pipe(ws);
        ws.on("finish", () => {
          log(`video saved: public/${file} (${ws.bytesWritten} bytes at ${offset})`);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({file}));
        });
        ws.on("error", (e) => {
          log(`video save failed: ${e.message}`);
          res.statusCode = 500;
          res.end(String(e));
        });
        return;
      }

      // 2. run the render, stream its output back line by line
      if (req.method === "POST" && url.pathname === "/api/render") {
        if (busy) {
          log("refused: a render is already running");
          res.statusCode = 409;
          return res.end("A render is already running, wait for it to finish.");
        }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            JSON.parse(body);
          } catch (e) {
            res.statusCode = 400;
            return res.end(`The JSON sent by the preview is not valid: ${(e as Error).message}`);
          }
          fs.mkdirSync(path.join(ROOT, "scripts"), {recursive: true});
          fs.mkdirSync(path.join(ROOT, "out"), {recursive: true});
          fs.writeFileSync(path.join(ROOT, PROPS), body);
          log(`wrote ${PROPS} (${body.length} chars)`);

          busy = true;
          res.writeHead(200, {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no"});
          const args = ["remotion", "render", "ComicEdit", OUT, `--props=${PROPS}`, "--concurrency=2"];
          log(`running: npx ${args.join(" ")}`);
          res.write(`Starting: npx ${args.join(" ")}\n`);
          const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", args, {cwd: ROOT});
          const pass = (c: Buffer) => res.write(c);
          child.stdout.on("data", pass);
          child.stderr.on("data", pass);
          child.on("error", (e) => {
            log(`could not start: ${e.message}`);
            res.write(`\n[RENDER FAILED] could not start: ${e.message}\n`);
          });
          child.on("close", (code) => {
            busy = false;
            log(`render finished with code ${code}`);
            res.write(code === 0 ? "\n[RENDER DONE]\n" : `\n[RENDER FAILED] exit code ${code}\n`);
            res.end();
          });
          res.on("close", () => log("browser connection closed"));
        });
        return;
      }

      // the version line at the bottom of the pages asks which server it runs on
      if (req.method === "GET" && url.pathname === "/api/version") {
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({revision: "dev server"}));
      }

      // 3. the finished video
      if (req.method === "GET" && url.pathname === "/api/download") {
        const f = path.join(ROOT, OUT);
        if (!fs.existsSync(f)) {
          log(`download: ${OUT} does not exist`);
          res.statusCode = 404;
          return res.end("No exported video yet.");
        }
        log(`download: sending ${OUT} (${fs.statSync(f).size} bytes)`);
        res.writeHead(200, {"Content-Type": "video/mp4", "Content-Disposition": 'attachment; filename="comic.mp4"'});
        return void fs.createReadStream(f).pipe(res);
      }

      res.statusCode = 404;
      res.end("unknown endpoint");
    });
  },
});

// Dev server for the two-tab GUI. root = app/, the video is served from the same public/ folder Remotion uses.
// `npm run app:build` writes both pages to dist/ for server/server.mjs (public/ is not copied: the server serves it from the Remotion bundle).
export default defineConfig({
  root: "app",
  publicDir: "../public",
  plugins: [react(), renderApi()],
  // shown at the bottom of both pages (app/version.tsx)
  define: {
    __APP_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    copyPublicDir: false,
    rollupOptions: {input: {editor: path.resolve(ROOT, "app/index.html"), preview: path.resolve(ROOT, "app/preview.html")}},
  },
  server: {
    host: true, // host: true so a Codespace can forward the port
    port: 5173,
    fs: {allow: [".."]},
    watch: {ignored: ["**/out/**", "**/scripts/export.json", "**/public/export-input-*"]}, // files the export writes must not reload the page
  },
});