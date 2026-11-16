// app/pipeline.ts
// NEW FILE: the steps of making the finished video, shared by the simple view (app/simple.tsx) and the full preview (app/previewPanel.tsx).

// Files go to the server in pieces: Cloud Run refuses request bodies over 32 MB. Returns the name the server saved it as.
const UPLOAD_PIECE = 8 * 1024 * 1024;
export const uploadFile = async (f: File, name: string, onProgress?: (sent: number, total: number) => void): Promise<string> => {
  let saved = "";
  for (let offset = 0; offset === 0 || offset < f.size; offset += UPLOAD_PIECE) {
    const up = await fetch(`/api/upload?name=${encodeURIComponent(name)}&offset=${offset}`, {method: "POST", body: f.slice(offset, offset + UPLOAD_PIECE)});
    if (!up.ok) throw new Error(`upload of ${f.name} failed: ${up.status} ${await up.text()}`);
    saved = (await up.json()).file;
    const sent = Math.min(offset + UPLOAD_PIECE, f.size);
    console.log(`[Pipeline] upload ${f.name}: ${sent} of ${f.size} bytes`);
    onProgress?.(sent, f.size);
  }
  return saved;
};

// Render the JSON on the server; every line of its log goes to onLine. Resolves when the render is done, throws when it fails.
export const streamRender = async (spec: unknown, onLine: (line: string) => void): Promise<void> => {
  const res = await fetch("/api/render", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(spec)});
  if (!res.ok || !res.body) throw new Error(`render request failed: ${res.status} ${await res.text()}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let done = false;
  let failed = "";
  const line = (l: string) => {
    console.log("[Pipeline] render:", l);
    onLine(l);
    if (l.includes("[RENDER DONE]")) done = true;
    if (l.includes("[RENDER FAILED]")) failed = l;
  };
  for (;;) {
    const {done: end, value} = await reader.read();
    if (end) break;
    buf += dec.decode(value, {stream: true});
    const parts = buf.split(/[\r\n]+/);
    buf = parts.pop() ?? "";
    parts.filter(Boolean).forEach(line);
  }
  if (buf.trim()) line(buf.trim());
  if (!done) throw new Error(failed || "the render ended without finishing");
};
