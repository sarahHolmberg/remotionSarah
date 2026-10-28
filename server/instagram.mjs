// server/instagram.mjs
// NEW FILE: post exported videos straight to Instagram (Meta's Graph API, Facebook Login route), on a schedule.
//
// Scheduling: an export goes into the next free slot of the daily posting times (17:00, 19:00, 20:00 Stockholm),
// or at a time you pick, or right away. Each post is a "job": the video waits in the bucket (videos/...), the job in
// jobs/<id>.json, and a Cloud Task calls POST /api/instagram/run?job=<id> at the posting time.
// Publishing (Meta has no scheduling of its own): create a container from the video's public link -> wait until
// Instagram has processed it (FINISHED) -> media_publish. The video is deleted from the bucket after posting.
// Stories can't have a caption, tags or collaborators through the API; those are only sent for Reels.
//
// Server settings: IG_USER_ID, IG_ACCESS_TOKEN (a Page token that never expires; both from Secret Manager), MEDIA_BUCKET,
// INSTAGRAM_QUEUE (Cloud Tasks queue, default instagram-posts), TASKS_LOCATION (default us-central1).
//
//   GET    /api/instagram/queue        -> {slots: [next free times], jobs: [...]}
//   POST   /api/instagram/schedule     {type: "REELS"|"STORIES", caption, userTags, collaborators, coverSeconds, when: "slot"|"now"|"<ISO>"}
//   POST   /api/instagram/run?job=<id> (Cloud Tasks at the posting time, or the Retry button)
//   DELETE /api/instagram/jobs/<id>    (cancel a scheduled post / remove a finished one)

import fs from "node:fs";
import crypto from "node:crypto";
import {BUCKET, createTask, deleteObject, deleteTask, getJson, listObjects, publicUrl, putJson, putObject, randomName} from "./gcp.mjs";

const IG_USER = process.env.IG_USER_ID || "";
const TOKEN = process.env.IG_ACCESS_TOKEN || "";
const QUEUE = process.env.INSTAGRAM_QUEUE || "instagram-posts";
const LOCATION = process.env.TASKS_LOCATION || "us-central1";
const GRAPH = "https://graph.facebook.com/v26.0";

// ---- POSTING TIMES (change here) ----
const TZ = "Europe/Stockholm";
const SLOT_HOURS = [17, 19, 20]; // the daily posting times, Stockholm time
const LEAD_MINUTES = 10; // a slot closer than this is skipped (the video needs a moment to be ready)
const MAX_DAYS = 25; // how far ahead posts can go (the bucket deletes files after 30 days)
const PROCESS_MINUTES = 10; // how long to wait for Instagram to process a video before giving up

const log = (m) => console.log(`[Instagram] ${m}`);
// a structured ERROR line: shows up red in Cloud Logging, and a log alert can watch for it
const logError = (m) => console.log(JSON.stringify({severity: "ERROR", message: `[Instagram] ${m}`}));

// Cloud Tasks gets past the website password with this header; it is made from APP_PASSWORD, so it needs no extra setting
const TASK_KEY = crypto.createHash("sha256").update(`instagram-task:${process.env.APP_PASSWORD ?? ""}`).digest("hex");

// ---- Stockholm time -> UTC ----
const zoneParts = (ms) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"})
      .formatToParts(new Date(ms))
      .map((p) => [p.type, Number(p.value)])
  );
const offsetMs = (ms) => {
  const p = zoneParts(ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / 60000) * 60000; // how far Stockholm is ahead of UTC
};
export const stockholmToUtc = (y, m, d, h) => {
  const wall = Date.UTC(y, m - 1, d, h);
  return wall - offsetMs(wall - offsetMs(wall)); // twice, so the summer/winter time switch lands right
};

// the next free posting times after now (taken = times that already have a post)
export const freeSlots = (taken, count) => {
  const now = Date.now() + LEAD_MINUTES * 60000;
  const today = zoneParts(Date.now());
  const out = [];
  for (let i = 0; i <= MAX_DAYS && out.length < count; i++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    for (const h of SLOT_HOURS) {
      const t = stockholmToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h);
      if (t > now && !taken.has(t) && out.length < count) out.push(t);
    }
  }
  return out.map((t) => new Date(t).toISOString());
};

// ---- Meta's Graph API ----
const graph = async (path, params, method = "POST") => {
  const q = new URLSearchParams({...params, access_token: TOKEN});
  const r = method === "GET" ? await fetch(`${GRAPH}${path}?${q}`) : await fetch(`${GRAPH}${path}`, {method, body: q});
  const d = await r.json().catch(() => ({}));
  if (d.error) {
    const e = d.error;
    if (e.code === 190 || e.code === 102) {
      // the token itself no longer works (e.g. the Facebook password was changed): nothing will post until it is replaced
      const m = `AUTH ERROR: the Instagram access token no longer works (Meta: ${e.message}). Make a new Page access token and add it as a new version of the IG_ACCESS_TOKEN secret, then redeploy.`;
      logError(m);
      throw new Error(m);
    }
    throw new Error(`Meta ${path}: ${e.message}${e.error_user_msg ? ` (${e.error_user_msg})` : ""} [code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""}]`);
  }
  if (!r.ok) throw new Error(`Meta ${path}: ${r.status}`);
  return d;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// create container -> wait until FINISHED -> publish
const publish = async (job) => {
  const params = {media_type: job.type, video_url: publicUrl(job.video)};
  if (job.type === "REELS") {
    Object.assign(params, {caption: job.caption ?? "", share_to_feed: "true"});
    if (job.thumbOffsetMs) params.thumb_offset = String(job.thumbOffsetMs);
    if (job.collaborators?.length) params.collaborators = JSON.stringify(job.collaborators);
    if (job.userTags?.length) params.user_tags = JSON.stringify(job.userTags.map((username) => ({username})));
  }
  const {id: container} = await graph(`/${IG_USER}/media`, params);
  log(`job ${job.id}: container ${container}, waiting for Instagram to process the video`);
  const until = Date.now() + PROCESS_MINUTES * 60000;
  for (;;) {
    const c = await graph(`/${container}`, {fields: "status_code,status"}, "GET");
    if (c.status_code === "FINISHED") break;
    if (c.status_code === "ERROR" || c.status_code === "EXPIRED") throw new Error(`Instagram could not process the video: ${c.status ?? c.status_code}`);
    if (Date.now() > until) throw new Error(`Instagram was still processing the video after ${PROCESS_MINUTES} minutes (${c.status_code})`);
    await wait(5000);
  }
  const {id: media} = await graph(`/${IG_USER}/media_publish`, {creation_id: container});
  const {permalink} = await graph(`/${media}`, {fields: "permalink"}, "GET").catch(() => ({}));
  return {media, permalink};
};

// ---- jobs ----
const jobName = (id) => `jobs/${id}.json`;
const allJobs = async () => (await Promise.all((await listObjects("jobs/")).map((n) => getJson(n).catch(() => null)))).filter(Boolean).sort((a, b) => a.publishAt.localeCompare(b.publishAt));

const run = async (id) => {
  const job = await getJson(jobName(id));
  if (job.status === "posted") return job; // a task that ran twice: post only once
  if (job.status === "publishing" && Date.now() - job.startedAt < (PROCESS_MINUTES + 5) * 60000) return job;
  Object.assign(job, {status: "publishing", startedAt: Date.now(), error: undefined});
  await putJson(jobName(id), job);
  try {
    const r = await publish(job);
    Object.assign(job, {status: "posted", mediaId: r.media, permalink: r.permalink, postedAt: new Date().toISOString()});
    log(`job ${id}: posted ${r.permalink ?? r.media}`);
    await deleteObject(job.video).catch((e) => log(`job ${id}: could not delete the video: ${e.message}`));
  } catch (e) {
    Object.assign(job, {status: "failed", error: e.message});
    logError(`job ${id} (${job.type} for ${job.publishAt}) failed: ${e.message}`);
  }
  await putJson(jobName(id), job);
  return job;
};

// a problem with what was typed in the panel (answered with 400, not logged as a server error)
class InputError extends Error {}

const USERNAME = /^[A-Za-z0-9._]{1,30}$/;
const names = (list, what, max) => {
  const out = (Array.isArray(list) ? list : []).map((n) => String(n).trim().replace(/^@/, "")).filter(Boolean);
  const bad = out.filter((n) => !USERNAME.test(n));
  if (bad.length) throw new InputError(`${what}: not an Instagram username: ${bad.join(", ")}`);
  if (out.length > max) throw new InputError(`${what}: at most ${max}`);
  return out;
};

// Is this the Cloud Task calling? Then the website password is not needed for this one request.
export const isInstagramTask = (req, url) => {
  const k = String(req.headers["x-task-key"] ?? "");
  return url.pathname === "/api/instagram/run" && k.length === TASK_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(TASK_KEY));
};

// Answers /api/instagram requests; returns false for any other path.
export const makeInstagramHandler = (outFile) => {
  log(`account ${IG_USER || "NOT set (IG_USER_ID)"}, token ${TOKEN ? "set" : "NOT set (IG_ACCESS_TOKEN)"}, bucket ${BUCKET || "NOT set (MEDIA_BUCKET)"}, queue ${LOCATION}/${QUEUE}, times ${SLOT_HOURS.join(", ")} ${TZ}`);
  const send = (res, status, body) => {
    res.writeHead(status, {"Content-Type": "application/json", "Cache-Control": "no-cache"});
    res.end(JSON.stringify(body));
  };
  return (req, res, url) => {
    if (!url.pathname.startsWith("/api/instagram/")) return false;
    (async () => {
      const missing = [!IG_USER && "IG_USER_ID", !TOKEN && "IG_ACCESS_TOKEN", !BUCKET && "MEDIA_BUCKET"].filter(Boolean);
      if (missing.length) return send(res, 503, {error: `Posting to Instagram is not set up yet: ${missing.join(", ")} missing on the server.`});

      if (req.method === "GET" && url.pathname === "/api/instagram/queue") {
        const jobs = await allJobs();
        const taken = new Set(jobs.filter((j) => j.status === "scheduled" || j.status === "publishing").map((j) => Date.parse(j.publishAt)));
        return send(res, 200, {slots: freeSlots(taken, 3), times: SLOT_HOURS.map((h) => `${String(h).padStart(2, "0")}:00`), timeZone: TZ, jobs});
      }

      if (req.method === "POST" && url.pathname === "/api/instagram/run") {
        const id = url.searchParams.get("job") ?? "";
        if (!/^[a-f0-9]{16}$/.test(id)) return send(res, 400, {error: "bad job id"});
        log(`run job ${id}${isInstagramTask(req, url) ? " (Cloud Task)" : " (by hand)"}`);
        return send(res, 200, await run(id)); // always 200: a failure is recorded in the job, Cloud Tasks must not post it again
      }

      if (req.method === "POST" && url.pathname === "/api/instagram/schedule") {
        let body = "";
        for await (const c of req) body += c;
        const b = JSON.parse(body);
        if (!fs.existsSync(outFile)) return send(res, 400, {error: "No exported video yet: press Export video first."});
        const type = b.type === "STORIES" ? "STORIES" : "REELS";
        const reel = type === "REELS";
        const job = {
          id: crypto.randomBytes(8).toString("hex"),
          type,
          caption: reel ? String(b.caption ?? "").slice(0, 2200) : "",
          userTags: reel ? names(b.userTags, "Tag people", 20) : [],
          collaborators: reel ? names(b.collaborators, "Collaborators", 3) : [],
          thumbOffsetMs: reel && Number(b.coverSeconds) > 0 ? Math.round(Number(b.coverSeconds) * 1000) : 0,
          status: "scheduled",
          createdAt: new Date().toISOString(),
        };
        // when
        if (b.when === "now") job.publishAt = new Date().toISOString();
        else if (b.when === "slot" || !b.when) {
          const jobs = await allJobs();
          const taken = new Set(jobs.filter((j) => j.status === "scheduled" || j.status === "publishing").map((j) => Date.parse(j.publishAt)));
          [job.publishAt] = freeSlots(taken, 1);
          if (!job.publishAt) return send(res, 400, {error: `Every posting time in the next ${MAX_DAYS} days is taken.`});
        } else {
          const t = Date.parse(b.when);
          if (!Number.isFinite(t) || t < Date.now() + 60000 || t > Date.now() + MAX_DAYS * 86400000) return send(res, 400, {error: `Pick a time between now and ${MAX_DAYS} days ahead.`});
          job.publishAt = new Date(t).toISOString();
        }
        job.video = await putObject(randomName("videos", "mp4"), fs.readFileSync(outFile), "video/mp4");
        await putJson(jobName(job.id), job);
        log(`job ${job.id}: ${type} at ${job.publishAt}, video ${job.video}`);

        if (b.when === "now") return send(res, 200, await run(job.id));
        job.task = await createTask({queue: QUEUE, location: LOCATION, url: `${process.env.SERVICE_URL || `https://${req.headers.host}`}/api/instagram/run?job=${job.id}`, at: job.publishAt, headers: {"X-Task-Key": TASK_KEY}});
        await putJson(jobName(job.id), job);
        return send(res, 200, job);
      }

      const del = /^\/api\/instagram\/jobs\/([a-f0-9]{16})$/.exec(url.pathname);
      if (req.method === "DELETE" && del) {
        const job = await getJson(jobName(del[1]));
        if (job.status === "publishing") return send(res, 409, {error: "This post is being published right now."});
        if (job.task && job.status === "scheduled") await deleteTask(job.task);
        if (job.status !== "posted") await deleteObject(job.video);
        await deleteObject(jobName(job.id));
        log(`job ${job.id}: removed (was ${job.status})`);
        return send(res, 200, {removed: job.id});
      }
      send(res, 404, {error: "unknown Instagram request"});
    })().catch((e) => {
      if (e instanceof InputError) return send(res, 400, {error: e.message});
      logError(`request ${url.pathname} failed: ${e.message}`);
      send(res, 500, {error: e.message});
    });
    return true;
  };
};
