// server/inbox.mjs
// NEW FILE: the video inbox. The grid player (another app) sends a link to each video that needs a comic edit; the editor
// shows the OLDEST one (the video being worked on now) until it is marked done, then the next.
//
//   POST   /api/inbox        from the grid player: header "Authorization: Bearer <INBOX_KEY>", JSON {"url": "...", "title": "..."}
//   GET    /api/inbox        the editor: {items: [{id, url, title, receivedAt}], oldest first}
//   DELETE /api/inbox/<id>   the editor's "Done" button
// The POST needs INBOX_KEY instead of the website password, so the grid player never needs the password. CORS is allowed
// for it, in case the grid player sends from a browser. Links are kept in the bucket (server/store.mjs): no extra cost.

import crypto from "node:crypto";
import {makeStore} from "./store.mjs";

const KEY = process.env.INBOX_KEY || "";
const log = (m) => console.log(`[Inbox] ${m}`);
const CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type"};

const keyOk = (req) => {
  const got = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  return !!KEY && got.length === KEY.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(KEY));
};

// the grid player's calls skip the website password: the POST with the right key, and the browser's CORS check before it
export const isInboxCall = (req, url) => url.pathname === "/api/inbox" && (req.method === "OPTIONS" || (req.method === "POST" && keyOk(req)));

export const makeInboxHandler = (root) => {
  const store = makeStore("inbox", `${root}/inbox`);
  log(`links kept in ${store.where}; sending key ${KEY ? "set" : "NOT set (INBOX_KEY)"}`);
  const send = (res, status, body, extra = {}) => {
    res.writeHead(status, {"Content-Type": "application/json", "Cache-Control": "no-cache", ...extra});
    res.end(JSON.stringify(body));
  };
  return (req, res, url) => {
    if (!url.pathname.startsWith("/api/inbox")) return false;
    (async () => {
      if (req.method === "OPTIONS") return send(res, 204, {}, CORS);
      if (req.method === "POST" && url.pathname === "/api/inbox") {
        if (!KEY) return send(res, 503, {error: "The inbox is not set up: INBOX_KEY is missing on the server."}, CORS);
        if (!keyOk(req)) return send(res, 401, {error: "Wrong or missing key (Authorization: Bearer <INBOX_KEY>)."}, CORS);
        let body = "";
        for await (const c of req) body += c;
        let d;
        try {
          d = JSON.parse(body);
        } catch {
          return send(res, 400, {error: 'Send JSON like {"url": "https://..."}'}, CORS);
        }
        if (typeof d.url !== "string" || !/^https?:\/\/\S+$/.test(d.url) || d.url.length > 2000) return send(res, 400, {error: '"url" must be an http(s) link'}, CORS);
        const id = `${String(Date.now()).padStart(15, "0")}-${crypto.randomBytes(3).toString("hex")}`; // sorts oldest first
        const item = {id, url: d.url, title: typeof d.title === "string" ? d.title.slice(0, 200) : "", receivedAt: new Date().toISOString()};
        await store.put(id, item);
        log(`received ${item.url}`);
        return send(res, 200, {received: id}, CORS);
      }
      if (req.method === "GET" && url.pathname === "/api/inbox") {
        const ids = (await store.list()).sort();
        const items = (await Promise.all(ids.map((id) => store.get(id)))).filter(Boolean);
        return send(res, 200, {items});
      }
      const del = /^\/api\/inbox\/([0-9]{15}-[a-f0-9]{6})$/.exec(url.pathname);
      if (req.method === "DELETE" && del) {
        await store.del(del[1]);
        log(`done ${del[1]}`);
        return send(res, 200, {done: del[1]});
      }
      send(res, 404, {error: "unknown inbox request"});
    })().catch((e) => {
      log(`failed: ${e.message}`);
      send(res, 500, {error: e.message});
    });
    return true;
  };
};
