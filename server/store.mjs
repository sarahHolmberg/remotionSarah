// server/store.mjs
// NEW FILE: a tiny key -> JSON store. On Cloud Run it keeps everything in the Cloud Storage bucket MEDIA_BUCKET
// (under one folder per use, e.g. profiles/ or inbox/), so it survives the server going to sleep; elsewhere (the Codespace)
// it uses a local folder. Used for saved profiles (server/profiles.mjs) and the video inbox (server/inbox.mjs).

import fs from "node:fs";
import path from "node:path";
import {BUCKET, deleteObject, getJson, listObjects, putJson} from "./gcp.mjs";

export const onCloud = () => !!(BUCKET && process.env.K_REVISION); // K_REVISION is set by Cloud Run

export const makeStore = (folder, localDir) =>
  onCloud()
    ? {
        where: `Cloud Storage (${BUCKET}/${folder}/)`,
        list: async () => (await listObjects(`${folder}/`)).map((n) => n.slice(folder.length + 1).replace(/\.json$/, "")).filter(Boolean),
        get: (key) => getJson(`${folder}/${key}.json`).catch(() => null),
        put: (key, value) => putJson(`${folder}/${key}.json`, value),
        del: (key) => deleteObject(`${folder}/${key}.json`),
      }
    : {
        where: `the folder ${localDir}${process.env.K_REVISION ? " (lost when the server restarts: set MEDIA_BUCKET)" : ""}`,
        list: async () => (fs.existsSync(localDir) ? fs.readdirSync(localDir).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)) : []),
        get: async (key) => {
          const f = path.join(localDir, `${key}.json`);
          return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
        },
        put: async (key, value) => {
          fs.mkdirSync(localDir, {recursive: true});
          fs.writeFileSync(path.join(localDir, `${key}.json`), JSON.stringify(value, null, 2) + "\n");
        },
        del: async (key) => fs.rmSync(path.join(localDir, `${key}.json`), {force: true}),
      };
