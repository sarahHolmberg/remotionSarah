// server/tasks.mjs
// NEW FILE: automatic videos. The grid player sends a video + its transcript; a person turns the transcript into the
// JSON script on the Parrot site (/parrot/, app/parrot.tsx); then the server renders it and schedules the Reel + Story
// by itself (server/instagram.mjs), and deletes the original video.
//
// Storage: the video goes in the bucket's videos/ folder (task-<taskId>.mp4); a small record per task in tasks/
// (transcript, a funny name, the video's length, the status). Before a video is accepted, the whole bucket is added up:
// over STORAGE_LIMIT_BYTES (default 4.5 GB, under the 5 GB free tier) it is refused. Off Cloud Run (the Codespace)
// a local folder is used and the processing runs in this process.
//
// Status of a task: needs_script -> queued -> making -> scheduled -> posted, or failed (with "error").
//
// Grid player (header "Authorization: Bearer <INBOX_KEY>"):
//   POST /api/tasks            form: taskId, transcript, video (mp4, max 13 MB) -> 202 ACCEPTED / 200 DUPLICATE / errors with "code"
//   GET  /api/tasks/<taskId>   -> {status, publishAt?, permalink?, error?}
// Editor (website password):  GET /api/tasks (the list), POST /api/tasks/<taskId>/retry
// Cloud Tasks (X-Task-Key):   POST /api/tasks/run?task=<taskId>  (does the render + scheduling)
// Parrot (its own password PARROT_PASSWORD, default "parrot"; any username):
//   GET /parrot/ (the page), GET /parrot/api/next?client=, POST /parrot/api/script?task=&client=, POST /parrot/api/skip?task=

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {Readable} from "node:stream";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {bucketBytes, createTask, deleteObject, getObjectBuffer, putObject} from "./gcp.mjs";
import {makeStore, onCloud} from "./store.mjs";
import {getJobs, InputError, instagramReady, nextFreeSlot, scheduleReelAndStory} from "./instagram.mjs";

const KEY = process.env.INBOX_KEY || ""; // the grid player's key (the same one the video links use)
const PARROT_PASSWORD = process.env.PARROT_PASSWORD || "parrot";
const MAX_VIDEO = 13 * 1024 * 1024; // 13 MB
const LIMIT = Number(process.env.STORAGE_LIMIT_BYTES || 4.5 * 1024 ** 3);
const CLAIM_MINUTES = 15; // a task opened on Parrot is held for that person this long
const QUEUE = process.env.INSTAGRAM_QUEUE || "instagram-posts"; // the same Cloud Tasks queue the posting uses
const LOCATION = process.env.TASKS_LOCATION || "us-central1";
const TASK_KEY = crypto.createHash("sha256").update(`comic-task:${process.env.APP_PASSWORD ?? ""}`).digest("hex");
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

const log = (m) => console.log(`[Tasks] ${m}`);
const logError = (m) => console.log(JSON.stringify({severity: "ERROR", message: `[Tasks] ${m}`}));
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const bearer = (req) => String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
const keyOk = (req) => !!KEY && same(bearer(req), KEY);
const parrotOk = (req) => {
  const m = /^Basic (.+)$/.exec(req.headers.authorization ?? "");
  const pass = m ? Buffer.from(m[1], "base64").toString().split(":").slice(1).join(":") : "";
  const h = (s) => crypto.createHash("sha256").update(s).digest();
  return !!m && crypto.timingSafeEqual(h(pass), h(PARROT_PASSWORD));
};

// a funny name per task, the same every time for the same taskId (Parrot shows it instead of the dancer's name)
const ADJ = ["Velvet", "Sneaky", "Brave", "Fuzzy", "Jolly", "Cosmic", "Sleepy", "Spicy", "Groovy", "Tiny", "Mighty", "Bouncy", "Sparkly", "Dizzy", "Lucky", "Zesty", "Cheeky", "Golden", "Wobbly", "Snappy"];
const ANIMAL = ["Otter", "Penguin", "Llama", "Panda", "Gecko", "Walrus", "Koala", "Badger", "Flamingo", "Hedgehog", "Toucan", "Narwhal", "Lobster", "Moose", "Ferret", "Pelican", "Yak", "Octopus", "Raccoon", "Sloth"];
const funnyName = (id) => {
  const h = crypto.createHash("sha256").update(id).digest();
  return `${ADJ[h[0] % ADJ.length]} ${ANIMAL[h[1] % ANIMAL.length]}`;
};

// the video's length in seconds, with Remotion's own ffprobe; null when it isn't a readable video
const videoSeconds = async (file) => {
  try {
    const {stdout} = await promisify(execFile)(process.platform === "win32" ? "npx.cmd" : "npx", ["remotion", "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "format=duration", "-of", "csv=p=0", file], {timeout: 60000});
    const s = parseFloat(stdout.trim());
    return Number.isFinite(s) && s > 0 ? s : null;
  } catch {
    return null;
  }
};

export const makeTasks = ({root, publicDir, distDir, render, authorized}) => {
  const store = makeStore("tasks", path.join(root, "tasks"));
  const localVideos = path.join(root, "tasks-videos"); // off Cloud Run only
  log(`tasks kept in ${store.where}; grid player key ${KEY ? "set" : "NOT set (INBOX_KEY)"}; storage limit ${(LIMIT / 1024 ** 3).toFixed(2)} GB; Parrot password ${process.env.PARROT_PASSWORD ? "set" : 'default ("parrot")'}`);

  // ---- the video file of a task: in the bucket on Cloud Run, a local folder elsewhere ----
  const saveVideo = async (id, buf) => {
    if (onCloud()) return putObject(`videos/task-${id}.mp4`, buf, "video/mp4");
    fs.mkdirSync(localVideos, {recursive: true});
    const f = path.join(localVideos, `${id}.mp4`);
    fs.writeFileSync(f, buf);
    return f;
  };
  const loadVideo = async (task) => (onCloud() ? getObjectBuffer(task.video) : fs.readFileSync(task.video));
  const dropVideo = async (task) => (onCloud() ? deleteObject(task.video) : fs.rmSync(task.video, {force: true}));

  const send = (res, status, body, extra = {}) => {
    res.writeHead(status, {"Content-Type": "application/json", "Cache-Control": "no-store", ...extra});
    res.end(JSON.stringify(body));
  };
  const fail = (res, status, code, message, more = {}) => send(res, status, {ok: false, code, message, ...more});
  const publicStatus = (t) => ({ok: true, taskId: t.taskId, status: t.status, ...(t.publishAt ? {publishAt: t.publishAt} : {}), ...(t.permalink ? {permalink: t.permalink} : {}), ...(t.error ? {error: t.error} : {})});

  // scheduled -> posted, once both posts have gone out (looked up when someone asks)
  const refresh = async (t) => {
    if (t.status !== "scheduled" || !t.jobs?.length) return t;
    const jobs = await getJobs(t.jobs).catch(() => []);
    if (jobs.length === t.jobs.length && jobs.every((j) => j.status === "posted")) {
      Object.assign(t, {status: "posted", permalink: jobs.find((j) => j.type === "REELS")?.permalink});
      await store.put(t.taskId, t);
    }
    return t;
  };

  // ---- the work: render the script over the video, schedule the Reel + Story, delete the original ----
  const runTask = async (id) => {
    const t = await store.get(id);
    if (!t || t.status !== "queued") return t;
    Object.assign(t, {status: "making", startedAt: new Date().toISOString(), error: undefined});
    await store.put(id, t);
    const input = path.join(publicDir, `task-${id}.mp4`);
    const out = path.join(root, "out", `task-${id}.mp4`);
    try {
      fs.mkdirSync(publicDir, {recursive: true});
      fs.mkdirSync(path.dirname(out), {recursive: true});
      fs.writeFileSync(input, await loadVideo(t));
      log(`${id}: rendering`);
      await render({...t.script, video: {file: `task-${id}.mp4`}}, out, (l) => log(`${id}: ${l}`));
      log(`${id}: rendered, scheduling the Reel + Story`);
      const jobs = await scheduleReelAndStory(out, {caption: t.script.caption ?? "", userTags: [t.script.username], collaborators: [], coverSeconds: 0, when: "slot"}, t.baseUrl);
      Object.assign(t, {status: "scheduled", publishAt: jobs[0].publishAt, jobs: jobs.map((j) => j.id), doneAt: new Date().toISOString()});
      await store.put(id, t);
      await dropVideo(t).catch((e) => log(`${id}: could not delete the original video: ${e.message}`)); // the posts have their own copies
      log(`${id}: scheduled for ${t.publishAt}`);
    } catch (e) {
      Object.assign(t, {status: "failed", error: e.message});
      await store.put(id, t);
      logError(`${id} failed: ${e.message}`);
    } finally {
      fs.rmSync(input, {force: true});
      fs.rmSync(out, {force: true});
    }
    return t;
  };

  // start the work: through Cloud Tasks on Cloud Run (the render then has its own request, so it gets the CPU),
  // directly in this process elsewhere
  const enqueue = async (t) => {
    if (!onCloud()) return void runTask(t.taskId).catch((e) => logError(e.message));
    await createTask({queue: QUEUE, location: LOCATION, url: `${t.baseUrl}/api/tasks/run?task=${t.taskId}`, at: new Date().toISOString(), headers: {"X-Task-Key": TASK_KEY}});
  };

  // ---- the script a person sends from Parrot: the basics are checked here (Parrot already checked everything) ----
  const scriptProblem = (s) => {
    if (!s || typeof s !== "object" || Array.isArray(s)) return "The script must be one JSON object.";
    if (!Array.isArray(s.captions) || !s.captions.length) return 'The script has no "captions".';
    if (typeof s.username !== "string" || !USERNAME.test(s.username.replace(/^@/, ""))) return 'The script needs a "username" (letters, digits, . and _).';
    if (s.caption !== undefined && typeof s.caption !== "string") return '"caption" must be text.';
    return null;
  };

  // ---- the grid player's upload ----
  const receive = async (req, res) => {
    if (!KEY) return fail(res, 503, "NOT_READY", "The server has no INBOX_KEY set.");
    if (!keyOk(req)) return fail(res, 401, "WRONG_KEY", "The Authorization header is missing or the key is wrong.");
    if (Number(req.headers["content-length"] || 0) > MAX_VIDEO + 1024 * 1024) return fail(res, 413, "VIDEO_TOO_BIG", `The video is over ${MAX_VIDEO} bytes.`);
    if (onCloud() && !instagramReady()) return fail(res, 503, "NOT_READY", "Instagram posting is not set up on the server.");
    let form;
    try {
      form = await new Request("http://x", {method: "POST", headers: {"content-type": String(req.headers["content-type"] ?? "")}, body: Readable.toWeb(req), duplex: "half"}).formData();
    } catch (e) {
      return fail(res, 400, "BAD_REQUEST", `Send multipart/form-data with the fields taskId, transcript and video (${e.message}).`);
    }
    const taskId = String(form.get("taskId") ?? "");
    const transcript = form.get("transcript");
    const video = form.get("video");
    if (!ID.test(taskId)) return fail(res, 400, "BAD_REQUEST", 'taskId is missing or invalid (letters, digits, "-" and "_", 1 to 64).');
    const old = await store.get(taskId);
    if (old) return send(res, 200, {ok: true, code: "DUPLICATE", taskId, status: old.status});
    if (typeof transcript !== "string" || !transcript.trim() || transcript.length > 50000) return fail(res, 400, "BAD_REQUEST", "transcript is missing, empty or over 50,000 characters.");
    if (!video || typeof video === "string") return fail(res, 400, "BAD_REQUEST", "video is missing (send it as a file).");
    if (video.size > MAX_VIDEO) return fail(res, 413, "VIDEO_TOO_BIG", `The video is ${video.size} bytes; the maximum is ${MAX_VIDEO}.`);
    const buf = Buffer.from(await video.arrayBuffer());
    const tmp = path.join(os.tmpdir(), `check-${crypto.randomBytes(4).toString("hex")}.mp4`);
    fs.writeFileSync(tmp, buf);
    const seconds = await videoSeconds(tmp);
    fs.rmSync(tmp, {force: true});
    if (!seconds) return fail(res, 400, "VIDEO_UNREADABLE", "The file is not a playable MP4 video.");
    if (onCloud()) {
      const used = await bucketBytes();
      if (used + buf.length > LIMIT) return fail(res, 507, "STORAGE_FULL", "The server's storage is full; try again later.", {usedBytes: used, limitBytes: LIMIT, incomingBytes: buf.length});
      if (!(await nextFreeSlot())) return fail(res, 409, "SLOTS_FULL", "Every posting time for the next 25 days is taken.");
    }
    const t = {
      taskId,
      name: funnyName(taskId),
      status: "needs_script",
      transcript: transcript.trim(),
      durationSeconds: seconds,
      bytes: buf.length,
      video: await saveVideo(taskId, buf),
      baseUrl: process.env.SERVICE_URL || `${onCloud() ? "https" : "http"}://${req.headers.host}`,
      createdAt: new Date().toISOString(),
      order: Date.now(),
    };
    await store.put(taskId, t);
    log(`${taskId} (${t.name}): received, ${(buf.length / 1e6).toFixed(1)} MB, ${seconds.toFixed(1)} s; waiting for a script`);
    send(res, 202, {ok: true, code: "ACCEPTED", taskId, status: t.status});
  };

  const all = async () => (await Promise.all((await store.list()).map((id) => store.get(id)))).filter(Boolean);

  // ---- Parrot ----
  const parrotTypes = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".json": "application/json", ".png": "image/png"};
  const parrot = async (req, res, url) => {
    if (!parrotOk(req)) {
      res.writeHead(401, {"WWW-Authenticate": 'Basic realm="Parrot"'});
      return res.end("Password needed.");
    }
    const client = String(url.searchParams.get("client") ?? "").slice(0, 64);
    if (req.method === "GET" && url.pathname === "/parrot/api/next") {
      const now = Date.now();
      const waiting = (await all()).filter((t) => t.status === "needs_script").sort((a, b) => a.order - b.order);
      const t = waiting.find((x) => !x.claim || x.claim.until < now || x.claim.by === client);
      if (!t) return send(res, 200, {task: null, waiting: waiting.length, held: waiting.length}); // all held by other people
      t.claim = {by: client, until: now + CLAIM_MINUTES * 60000};
      await store.put(t.taskId, t);
      return send(res, 200, {task: {taskId: t.taskId, name: t.name, transcript: t.transcript, durationSeconds: t.durationSeconds}, waiting: waiting.length});
    }
    const id = String(url.searchParams.get("task") ?? "");
    if (req.method === "POST" && (url.pathname === "/parrot/api/script" || url.pathname === "/parrot/api/skip")) {
      if (!ID.test(id)) return send(res, 400, {error: "bad task id"});
      const t = await store.get(id);
      if (!t || t.status !== "needs_script") return send(res, 409, {error: "This one was already done (or removed)."});
      if (url.pathname === "/parrot/api/skip") {
        Object.assign(t, {order: Date.now(), claim: null});
        await store.put(id, t);
        return send(res, 200, {ok: true});
      }
      let body = "";
      for await (const c of req) body += c;
      let script;
      try {
        script = JSON.parse(body);
      } catch {
        return send(res, 400, {error: "The script is not valid JSON."});
      }
      const problem = scriptProblem(script);
      if (problem) return send(res, 400, {error: problem});
      script.username = script.username.replace(/^@/, "");
      Object.assign(t, {script, status: "queued", claim: null, scriptAt: new Date().toISOString()});
      await store.put(id, t);
      await enqueue(t);
      log(`${id} (${t.name}): script in, queued`);
      return send(res, 200, {ok: true});
    }
    if (req.method === "GET") {
      // the page and its files (built by npm run app:build into dist/parrot)
      const rel = url.pathname === "/parrot/" ? "parrot.html" : decodeURIComponent(url.pathname.slice("/parrot/".length));
      const f = path.join(distDir, rel);
      if (f.startsWith(distDir + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, {"Content-Type": parrotTypes[path.extname(f)] ?? "application/octet-stream", ...(f.endsWith(".html") ? {"Cache-Control": "no-cache"} : {})});
        return void fs.createReadStream(f).pipe(res);
      }
    }
    res.writeHead(404);
    res.end("not found");
  };

  // Answers everything for the tasks and Parrot; false for any other request. Each part checks its own key/password.
  const handle = (req, res, url) => {
    const p = url.pathname;
    if (p === "/parrot") {
      res.writeHead(301, {Location: "/parrot/"});
      return void res.end() || true;
    }
    const isParrot = p.startsWith("/parrot/");
    if (!isParrot && !p.startsWith("/api/tasks")) return false;
    (async () => {
      if (isParrot) return parrot(req, res, url);
      if (req.method === "POST" && p === "/api/tasks") return receive(req, res);
      if (req.method === "POST" && p === "/api/tasks/run") {
        if (!same(String(req.headers["x-task-key"] ?? ""), TASK_KEY)) return fail(res, 401, "WRONG_KEY", "not the task runner");
        const id = String(url.searchParams.get("task") ?? "");
        log(`run ${id} (Cloud Task)`);
        const t = ID.test(id) ? await runTask(id) : null;
        return send(res, 200, t ? publicStatus(t) : {ok: false}); // always 200: a failure is recorded in the task, it must not run twice
      }
      const one = /^\/api\/tasks\/([A-Za-z0-9_-]{1,64})$/.exec(p);
      if (req.method === "GET" && one && (keyOk(req) || authorized(req))) {
        const t = await store.get(one[1]);
        return t ? send(res, 200, publicStatus(await refresh(t))) : fail(res, 404, "NOT_FOUND", "Unknown taskId.");
      }
      // the editor (website password): the list, and Retry for a failed one
      if (!authorized(req)) {
        res.writeHead(401, {"WWW-Authenticate": 'Basic realm="Comic editor"'});
        return res.end("Password needed.");
      }
      if (req.method === "GET" && p === "/api/tasks") {
        const list = (await all()).sort((a, b) => b.order - a.order).slice(0, 30);
        return send(res, 200, {tasks: await Promise.all(list.map(async (t) => ({...publicStatus(await refresh(t)), name: t.name, createdAt: t.createdAt})))});
      }
      const retry = /^\/api\/tasks\/([A-Za-z0-9_-]{1,64})\/retry$/.exec(p);
      if (req.method === "POST" && retry) {
        const t = await store.get(retry[1]);
        if (!t || t.status !== "failed") return fail(res, 409, "NOT_FAILED", "Only a failed task can be retried.");
        Object.assign(t, {status: t.script ? "queued" : "needs_script", error: undefined});
        await store.put(t.taskId, t);
        if (t.script) await enqueue(t);
        return send(res, 200, publicStatus(t));
      }
      fail(res, 404, "NOT_FOUND", "unknown tasks request");
    })().catch((e) => {
      if (e instanceof InputError) return fail(res, 400, "BAD_REQUEST", e.message);
      logError(`${p} failed: ${e.message}`);
      if (!res.headersSent) fail(res, 500, "SERVER_ERROR", e.message);
    });
    return true;
  };

  return {handle};
};
