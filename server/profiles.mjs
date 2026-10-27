// server/profiles.mjs
// NEW FILE: saved settings ("profiles") for the editor tab. Used by server/server.mjs (Cloud Run) and app/vite.config.ts (Codespace).
//
// With GITHUB_TOKEN set: each profile is a file profiles/<name>.json in the GitHub repo, on the branch "profiles"
// (not main, so saving a profile never starts a new deploy). Without it: the profiles/ folder next to the code
// (fine in the Codespace; on Cloud Run that folder is lost when the server restarts).
//
//   GET /api/profiles         -> {profiles: ["dance", ...], where: "..."}
//   GET /api/profiles/<name>  -> the saved settings
//   PUT /api/profiles/<name>  -> save the settings in the body

import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.GITHUB_TOKEN || "";
const REPO = process.env.GITHUB_REPO || "sarahHolmberg/remotionSarah";
const BRANCH = process.env.PROFILES_BRANCH || "profiles";
const NAME = /^[A-Za-z0-9_-]{1,40}$/;

const log = (m) => console.log(`[Profiles] ${m}`);

const gh = async (p, init = {}) => {
  const r = await fetch(`https://api.github.com/repos/${REPO}${p}`, {
    ...init,
    headers: {Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "remotion-render", ...(init.headers ?? {})},
  });
  if (!r.ok && r.status !== 404) throw new Error(`GitHub ${init.method ?? "GET"} ${p}: ${r.status} ${await r.text()}`);
  return r.status === 404 ? null : r.json();
};

const github = {
  where: `GitHub (${REPO}, branch ${BRANCH}, folder profiles/)`,
  list: async () => ((await gh(`/contents/profiles?ref=${BRANCH}`)) ?? []).map((f) => f.name).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)),
  get: async (name) => {
    const f = await gh(`/contents/profiles/${name}.json?ref=${BRANCH}`);
    return f && JSON.parse(Buffer.from(f.content, "base64").toString("utf8"));
  },
  save: async (name, data) => {
    if (!(await gh(`/git/ref/heads/${BRANCH}`))) {
      // first save ever: start the branch from main
      const main = await gh("/git/ref/heads/main");
      await gh("/git/refs", {method: "POST", body: JSON.stringify({ref: `refs/heads/${BRANCH}`, sha: main.object.sha})});
      log(`created branch ${BRANCH}`);
    }
    const old = await gh(`/contents/profiles/${name}.json?ref=${BRANCH}`);
    const content = Buffer.from(JSON.stringify(data, null, 2) + "\n").toString("base64");
    await gh(`/contents/profiles/${name}.json`, {method: "PUT", body: JSON.stringify({message: `Save profile ${name}`, content, branch: BRANCH, ...(old ? {sha: old.sha} : {})})});
  },
};

const local = (dir) => ({
  where: `the server's own folder ${dir}${process.env.K_REVISION ? " (lost when the server restarts: set GITHUB_TOKEN to keep profiles)" : ""}`,
  list: async () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)) : []),
  get: async (name) => {
    const f = path.join(dir, `${name}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
  },
  save: async (name, data) => {
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data, null, 2) + "\n");
  },
});

// Answers /api/profiles requests; returns false for any other path.
export const makeProfileHandler = (root) => {
  const store = TOKEN ? github : local(path.join(root, "profiles"));
  log(`profiles are kept in ${store.where}`);
  const send = (res, status, body) => {
    res.writeHead(status, {"Content-Type": "application/json", "Cache-Control": "no-cache"});
    res.end(JSON.stringify(body));
  };
  return (req, res, url) => {
    if (!url.pathname.startsWith("/api/profiles")) return false;
    const name = decodeURIComponent(url.pathname.slice("/api/profiles/".length));
    (async () => {
      if (req.method === "GET" && url.pathname === "/api/profiles") return send(res, 200, {profiles: (await store.list()).sort(), where: store.where});
      if (!NAME.test(name)) return send(res, 400, {error: "A profile name can only have letters, numbers, - and _ (up to 40)."});
      if (req.method === "GET") {
        const data = await store.get(name);
        return data ? send(res, 200, data) : send(res, 404, {error: `No profile called ${name}.`});
      }
      if (req.method === "PUT") {
        let body = "";
        for await (const c of req) body += c;
        await store.save(name, JSON.parse(body));
        log(`saved ${name}`);
        return send(res, 200, {saved: name, where: store.where});
      }
      send(res, 405, {error: "unknown profile request"});
    })().catch((e) => {
      log(`failed: ${e.message}`);
      send(res, 500, {error: e.message});
    });
    return true;
  };
};
