// server/buffer.mjs
// NEW FILE: "Send to Buffer" for the preview tab. Used by server/server.mjs (Cloud Run only).
//
// Instagram is left out when the server posts to Instagram directly (IG_ACCESS_TOKEN set, server/instagram.mjs): Buffer is for TikTok and the rest.
// 1. the exported video (out/comic.mp4) is copied to the Cloud Storage bucket MEDIA_BUCKET, where it has a public link.
//    Buffer downloads the video when the post goes out (not when it is scheduled), so it has to stay there until then;
//    the bucket deletes old videos by itself (lifecycle rule).
// 2. one Buffer post per chosen channel: the video link + the caption, into the queue / now / at a time.
// Buffer API: GraphQL at https://api.buffer.com, personal API key (BUFFER_API_KEY) as a Bearer token. Docs: https://developers.buffer.com
//
//   GET  /api/buffer/channels  -> {channels: [{id, name, service}]}  (or {error})
//   POST /api/buffer/send      {text, channelIds: [...], when: "queue" | "now" | "<ISO time>"} -> {video, results: [{channel, ok, message}]}

import fs from "node:fs";
import {BUCKET, publicUrl, putObject, randomName} from "./gcp.mjs";

const KEY = process.env.BUFFER_API_KEY || "";
const IG_DIRECT = !!process.env.IG_ACCESS_TOKEN; // Instagram goes straight to Meta (server/instagram.mjs): Buffer then only does the other networks

const log = (m) => console.log(`[Buffer] ${m}`);

const gql = async (query, variables = {}) => {
  const r = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: {Authorization: `Bearer ${KEY}`, "Content-Type": "application/json"},
    body: JSON.stringify({query, variables}),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.errors?.length) throw new Error(`Buffer ${r.status}: ${body.errors?.map((e) => e.message).join("; ") || JSON.stringify(body)}`);
  return body.data;
};

const channels = async () => {
  const {account} = await gql("query { account { organizations { id name } } }");
  const all = [];
  for (const org of account.organizations) {
    const d = await gql("query ($input: ChannelsInput!) { channels(input: $input) { id name displayName service } }", {input: {organizationId: org.id}});
    d.channels.filter((c) => !(IG_DIRECT && c.service === "instagram")).forEach((c) => all.push({id: c.id, name: c.displayName || c.name, service: c.service}));
  }
  return all;
};

// the bucket gives the video a public link that lasts until the bucket's lifecycle rule deletes it
const toBucket = async (file) => publicUrl(await putObject(randomName("videos", "mp4"), fs.readFileSync(file), "video/mp4"));

const CREATE = `mutation ($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id dueAt } }
    ... on MutationError { message }
  }
}`;

// one post for one channel. Instagram needs to be told it is a reel; other networks take the video as it is.
const post = async (channel, text, url, when) => {
  const input = {
    channelId: channel.id,
    text,
    schedulingType: "automatic",
    mode: when === "queue" ? "addToQueue" : when === "now" ? "shareNow" : "customScheduled",
    ...(when !== "queue" && when !== "now" ? {dueAt: when} : {}),
    assets: [{video: {url}}],
    ...(channel.service === "instagram" ? {metadata: {instagram: {type: "reel", shouldShareToFeed: true}}} : {}),
  };
  const {createPost: res} = await gql(CREATE, {input});
  if (res.__typename !== "PostActionSuccess") throw new Error(res.message ?? res.__typename);
  return res.post;
};

// Answers /api/buffer requests; returns false for any other path.
export const makeBufferHandler = (outFile) => {
  log(`Buffer ${KEY ? "key set" : "NOT set (BUFFER_API_KEY)"}, video bucket ${BUCKET || "NOT set (MEDIA_BUCKET)"}`);
  const send = (res, status, body) => {
    res.writeHead(status, {"Content-Type": "application/json", "Cache-Control": "no-cache"});
    res.end(JSON.stringify(body));
  };
  return (req, res, url) => {
    if (!url.pathname.startsWith("/api/buffer/")) return false;
    (async () => {
      if (!KEY || !BUCKET) return send(res, 503, {error: `Sending to Buffer is not set up yet: ${[!KEY && "BUFFER_API_KEY", !BUCKET && "MEDIA_BUCKET"].filter(Boolean).join(" and ")} missing on the server.`});
      if (req.method === "GET" && url.pathname === "/api/buffer/channels") return send(res, 200, {channels: await channels()});
      if (req.method === "POST" && url.pathname === "/api/buffer/send") {
        let body = "";
        for await (const c of req) body += c;
        const {text, channelIds, when} = JSON.parse(body);
        if (!fs.existsSync(outFile)) return send(res, 400, {error: "No exported video yet: press Export video first."});
        if (!Array.isArray(channelIds) || !channelIds.length) return send(res, 400, {error: "Pick at least one channel."});
        const chosen = (await channels()).filter((c) => channelIds.includes(c.id));
        const video = await toBucket(outFile);
        log(`video in the bucket: ${video}`);
        const results = [];
        for (const c of chosen) {
          try {
            const p = await post(c, text ?? "", video, when);
            log(`posted to ${c.service} ${c.name}: ${p.id}, due ${p.dueAt}`);
            results.push({channel: `${c.service}: ${c.name}`, ok: true, message: p.dueAt ? `scheduled for ${p.dueAt}` : "sent"});
          } catch (e) {
            log(`${c.service} ${c.name} failed: ${e.message}`);
            results.push({channel: `${c.service}: ${c.name}`, ok: false, message: e.message});
          }
        }
        return send(res, 200, {video, results});
      }
      send(res, 404, {error: "unknown Buffer request"});
    })().catch((e) => {
      log(`failed: ${e.message}`);
      send(res, 500, {error: e.message});
    });
    return true;
  };
};
