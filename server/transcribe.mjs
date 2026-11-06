// server/transcribe.mjs
// NEW FILE: speech to text for the transcription page (app/transcribe.tsx). Used by server/server.mjs and app/vite.config.ts.
//
//   POST /api/transcribe?name=recording.webm   (the recording as the request body) -> {text, model}
//
// Sends the recording to OpenAI's /v1/audio/transcriptions with OPENAI_API_KEY (never sent to the page).
// Model: OPENAI_TRANSCRIBE_MODEL, default gpt-transcribe (OpenAI's newest and most accurate, July 2026); if the account
// can't use it, gpt-4o-mini-transcribe is tried next. A short example of how the recordings sound is sent along as a
// "prompt", so the model writes "Target cell F13, time 8.668" the way the JSON prompt expects (and not "EFF13").

const KEY = process.env.OPENAI_API_KEY || "";
const MODELS = [...new Set([process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-transcribe", "gpt-4o-mini-transcribe"])];
const MAX_BYTES = 25 * 1024 * 1024; // OpenAI's limit per file
const VOCABULARY =
  "Name bubble. Target cell J6, time 0.965. Action, bend head down. Target cell G7, time 7.560. And. Target cell O9, time 7.560. Action, lock hands. Impact, cell F13, time 8.700.";
const TYPES = {webm: "audio/webm", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", mpeg: "audio/mpeg", mpga: "audio/mpeg", flac: "audio/flac"};

const log = (m) => console.log(`[Transcribe] ${m}`);

// one try with one model; returns {text} or {error, status, wrongModel, badPrompt}
const ask = async (file, name, model, withPrompt) => {
  const form = new FormData();
  form.append("file", new Blob([file], {type: TYPES[name.split(".").pop().toLowerCase()] ?? "application/octet-stream"}), name);
  form.append("model", model);
  form.append("response_format", "json");
  if (withPrompt) form.append("prompt", VOCABULARY);
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {method: "POST", headers: {Authorization: `Bearer ${KEY}`}, body: form});
  const body = await r.json().catch(() => ({}));
  if (r.ok) return {text: body.text ?? ""};
  const msg = body.error?.message ?? `HTTP ${r.status}`;
  return {error: msg, status: r.status, wrongModel: r.status === 404 || body.error?.code === "model_not_found" || /model/i.test(msg) && /not (found|exist|available|supported)|access/i.test(msg), badPrompt: r.status === 400 && /prompt/i.test(msg)};
};

const transcribe = async (file, name) => {
  let last;
  for (const model of MODELS) {
    let r = await ask(file, name, model, true);
    if (r.badPrompt) r = await ask(file, name, model, false); // a model that takes no prompt: try once without it
    if (!r.error) return {text: r.text, model};
    log(`${model} failed: ${r.error}`);
    last = r;
    if (!r.wrongModel) break; // only a model the account can't use is worth another model; anything else is reported
  }
  const err = new Error(last.status === 401 ? `OpenAI refused the key (${last.error}). Check the OPENAI_API_KEY secret.` : `OpenAI: ${last.error}`);
  err.status = last.status === 400 || last.status === 413 ? 400 : 502;
  throw err;
};

// Answers /api/transcribe; returns false for any other path.
export const makeTranscribeHandler = () => {
  log(`OpenAI key ${KEY ? "set" : "NOT set (OPENAI_API_KEY)"}, models ${MODELS.join(" -> ")}`);
  const send = (res, status, body) => {
    res.writeHead(status, {"Content-Type": "application/json", "Cache-Control": "no-cache"});
    res.end(JSON.stringify(body));
  };
  return (req, res, url) => {
    if (url.pathname !== "/api/transcribe") return false;
    (async () => {
      if (req.method !== "POST") return send(res, 405, {error: "POST the recording"});
      if (!KEY) return send(res, 503, {error: "Transcription is not set up yet: OPENAI_API_KEY is missing on the server."});
      const name = (url.searchParams.get("name") ?? "recording.webm").replace(/[^A-Za-z0-9._-]/g, "_");
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > MAX_BYTES) return send(res, 413, {error: "The recording is over 25 MB, OpenAI's limit. Record shorter parts, or export audio only."});
        chunks.push(c);
      }
      const started = Date.now();
      log(`${name}: ${(size / 1e6).toFixed(2)} MB`);
      const out = await transcribe(Buffer.concat(chunks), name);
      log(`${name}: ${out.text.length} characters with ${out.model} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      send(res, 200, out);
    })().catch((e) => {
      log(`failed: ${e.message}`);
      send(res, e.status ?? 500, {error: e.message});
    });
    return true;
  };
};
