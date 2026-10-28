// server/gcp.mjs
// NEW FILE: the Google Cloud pieces the server uses, through plain REST calls (no extra npm packages):
// the server's own Google token (from Cloud Run's metadata server), the storage bucket MEDIA_BUCKET, and Cloud Tasks.
// Only works on Cloud Run (the Codespace has no metadata server).

import crypto from "node:crypto";

export const BUCKET = process.env.MEDIA_BUCKET || "";
const META = "http://metadata.google.internal/computeMetadata/v1";

const meta = async (p) => {
  const r = await fetch(`${META}${p}`, {headers: {"Metadata-Flavor": "Google"}});
  if (!r.ok) throw new Error(`no Google metadata (this only works on Cloud Run): ${r.status}`);
  return r.text();
};

let cached = {token: "", until: 0};
export const googleToken = async () => {
  if (Date.now() < cached.until) return cached.token;
  const {access_token, expires_in} = JSON.parse(await meta("/instance/service-accounts/default/token"));
  cached = {token: access_token, until: Date.now() + (expires_in - 60) * 1000};
  return access_token;
};
export const projectId = () => meta("/project/project-id");

const google = async (url, init = {}) => {
  const r = await fetch(url, {...init, headers: {Authorization: `Bearer ${await googleToken()}`, ...(init.headers ?? {})}});
  if (!r.ok && !(init.method === "DELETE" && r.status === 404)) throw new Error(`${init.method ?? "GET"} ${url.split("?")[0]}: ${r.status} ${await r.text()}`);
  return r;
};

// ---- the bucket ----
export const randomName = (folder, ext) => `${folder}/${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${crypto.randomBytes(6).toString("hex")}.${ext}`; // the random part keeps the link unguessable
export const publicUrl = (name) => `https://storage.googleapis.com/${BUCKET}/${name}`;

export const putObject = async (name, body, contentType) => {
  await google(`https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(name)}`, {method: "POST", headers: {"Content-Type": contentType}, body});
  return name;
};
export const getJson = async (name) => (await google(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(name)}?alt=media`)).json();
export const putJson = (name, data) => putObject(name, JSON.stringify(data, null, 2), "application/json");
export const deleteObject = (name) => google(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(name)}`, {method: "DELETE"});
export const listObjects = async (prefix) => {
  const d = await (await google(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?prefix=${encodeURIComponent(prefix)}&fields=items(name)`)).json();
  return (d.items ?? []).map((o) => o.name);
};

// ---- Cloud Tasks: one HTTP call to this server at a set time ----
export const createTask = async ({queue, location, url, at, headers}) => {
  const parent = `projects/${await projectId()}/locations/${location}/queues/${queue}`;
  const r = await google(`https://cloudtasks.googleapis.com/v2/${parent}/tasks`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({task: {scheduleTime: at, dispatchDeadline: "900s", httpRequest: {url, httpMethod: "POST", headers}}}),
  });
  return (await r.json()).name; // projects/.../tasks/123, kept to cancel it
};
export const deleteTask = (name) => google(`https://cloudtasks.googleapis.com/v2/${name}`, {method: "DELETE"});
