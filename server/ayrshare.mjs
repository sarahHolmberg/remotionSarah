// server/ayrshare.mjs
// NEW FILE: "Send to Ayrshare" for the preview tab (replaces the Buffer version). Used by server/server.mjs.
//
// 1. the exported video (out/comic.mp4) is uploaded to Ayrshare: GET /media/uploadUrl gives a one-time upload link
//    and an accessUrl that stays valid for 30 days (so posts can be scheduled up to 30 days ahead).
// 2. POST /post with the caption, the chosen networks, the accessUrl, and a scheduleDate (or none = post now).
// Ayrshare API: https://api.ayrshare.com/api, API key (AYRSHARE_API_KEY) as a Bearer token. Docs: https://www.ayrshare.com/docs
// Posting video needs a paid Ayrshare plan.
//
//   GET  /api/ayrshare/accounts -> {accounts: ["instagram", "tiktok", ...]}  (or {error})
//   POST /api/ayrshare/send     {text, platforms: [...], when: "now" | "<ISO time>"} -> {status, results: [{platform, ok, message}]}

import fs from "node:fs";

const KEY = process.env.AYRSHARE_API_KEY || "";
const API = "https://api.ayrshare.com/api";

const log = (m) => console.log(`[Ayrshare] ${m}`);

const call = async (p, init = {}) => {
  const r = await fetch(`${API}${p}`, {...init, headers: {Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers ?? {})}});
  const body = await r.json().catch(() => ({}));
  if (!r.ok && body.status !== "error") throw new Error(`Ayrshare ${r.status}: ${JSON.stringify(body)}`);
  return body;
};

// the networks connected in Ayrshare
const accounts = async () => {
  const u = await call("/user");
  if (u.status === "error") throw new Error(u.message ?? JSON.stringify(u));
  return u.activeSocialAccounts ?? [];
};

// upload the video to Ayrshare's storage; returns the link the post uses
const upload = async (file) => {
  const name = `comic-${Date.now()}.mp4`;
  const u = await call(`/media/uploadUrl?fileName=${encodeURIComponent(name)}&contentType=mp4`);
  if (!u.uploadUrl || !u.accessUrl) throw new Error(`no upload link from Ayrshare: ${JSON.stringify(u)}`);
  const r = await fetch(u.uploadUrl, {method: "PUT", headers: {"Content-Type": u.contentType ?? "video/mp4"}, body: fs.readFileSync(file)});
  if (!r.ok) throw new Error(`uploading the video to Ayrshare failed: ${r.status} ${await r.text()}`);
  return u.accessUrl;
};

// Ayrshare answers one result per network in postIds, problems in errors (or as a single message)
const perPlatform = (res, platforms) =>
  platforms.map((platform) => {
    const ok = res.postIds?.find((p) => p.platform === platform);
    const err = res.errors?.find((e) => e.platform === platform);
    if (err) return {platform, ok: false, message: err.message ?? JSON.stringify(err)};
    if (ok) return {platform, ok: true, message: ok.postUrl ?? ok.status ?? "posted"};
    if (res.status === "scheduled") return {platform, ok: true, message: `scheduled for ${res.scheduleDate}`};
    return {platform, ok: res.status === "success", message: res.message ?? res.status ?? JSON.stringify(res)};
  });

// Answers /api/ayrshare requests; returns false for any other path.
export const makeAyrshareHandler = (outFile) => {
  log(`API key ${KEY ? "set" : "NOT set (AYRSHARE_API_KEY)"}`);
  const send = (res, status, body) => {
    res.writeHead(status, {"Content-Type": "application/json", "Cache-Control": "no-cache"});
    res.end(JSON.stringify(body));
  };
  return (req, res, url) => {
    if (!url.pathname.startsWith("/api/ayrshare/")) return false;
    (async () => {
      if (!KEY) return send(res, 503, {error: "Sending to Ayrshare is not set up yet: AYRSHARE_API_KEY is missing on the server."});
      if (req.method === "GET" && url.pathname === "/api/ayrshare/accounts") return send(res, 200, {accounts: await accounts()});
      if (req.method === "POST" && url.pathname === "/api/ayrshare/send") {
        let body = "";
        for await (const c of req) body += c;
        const {text, platforms, when} = JSON.parse(body);
        if (!fs.existsSync(outFile)) return send(res, 400, {error: "No exported video yet: press Export video first."});
        if (!Array.isArray(platforms) || !platforms.length) return send(res, 400, {error: "Pick at least one network."});
        const video = await upload(outFile);
        log(`video uploaded: ${video}`);
        const post = {
          post: text ?? "",
          platforms,
          mediaUrls: [video],
          isVideo: true,
          ...(when && when !== "now" ? {scheduleDate: new Date(when).toISOString().replace(/\.\d{3}Z$/, "Z")} : {}), // YYYY-MM-DDThh:mm:ssZ
        };
        const r = await call("/post", {method: "POST", body: JSON.stringify(post)});
        log(`post answer: ${JSON.stringify(r)}`);
        return send(res, 200, {status: r.status, results: perPlatform(r, platforms)});
      }
      send(res, 404, {error: "unknown Ayrshare request"});
    })().catch((e) => {
      log(`failed: ${e.message}`);
      send(res, 500, {error: e.message});
    });
    return true;
  };
};
