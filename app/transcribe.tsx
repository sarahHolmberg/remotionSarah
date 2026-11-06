// app/transcribe.tsx
// NEW FILE: the first page. A recording (WebM first, other audio works too) goes to the server, which has OpenAI turn it
// into text (server/transcribe.mjs). The text can be copied on its own, or already put into the JSON prompt
// (prompts/transcript-to-json.md) for the AI chat; then on to the comic editor.

/// <reference types="vite/client" />
import {useState, type DragEvent} from "react";
import {createRoot} from "react-dom/client";
import promptFile from "../prompts/transcript-to-json.md?raw";
import {VersionTag} from "./version";

const TEXT_KEY = "comic-transcript"; // the last transcript is kept in the browser, so a reload or a trip to the editor keeps it
const MAX_MB = 25; // OpenAI's limit per file

// the prompt is what sits between the two "---" lines of the prompt file; the transcript goes where it says to paste it
const promptWith = (transcript: string) => {
  const parts = promptFile.split(/\n---\n/);
  const body = (parts.length >= 3 ? parts[1] : promptFile).trim();
  return body.replace("<paste the transcript here>", transcript.trim());
};

const load = () => {
  try {
    return localStorage.getItem(TEXT_KEY) ?? "";
  } catch {
    return "";
  }
};

const Transcribe = () => {
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{kind: "ok" | "err" | ""; text: string}>({kind: "", text: ""});
  const [text, setTextState] = useState(load);
  const setText = (t: string) => {
    setTextState(t);
    try {
      localStorage.setItem(TEXT_KEY, t);
    } catch (e) {
      console.error("[Transcribe] cannot keep the transcript", e);
    }
  };

  const pick = (f: File | undefined) => {
    if (!f) return;
    console.log(`[Transcribe] picked ${f.name}, ${(f.size / 1e6).toFixed(2)} MB, type "${f.type}"`);
    if (f.size > MAX_MB * 1024 * 1024) return setMsg({kind: "err", text: `${f.name} is ${(f.size / 1e6).toFixed(1)} MB: OpenAI takes up to ${MAX_MB} MB per recording. Record shorter parts, or audio only.`});
    setFile(f);
    setMsg({kind: "", text: ""});
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    pick(e.dataTransfer.files[0]);
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setMsg({kind: "", text: `Transcribing ${file.name}... (about a few seconds per minute of recording)`});
    const started = Date.now();
    try {
      const r = await fetch(`/api/transcribe?name=${encodeURIComponent(file.name)}`, {method: "POST", body: file});
      const raw = await r.text();
      let d: {text?: string; model?: string; error?: string};
      try {
        d = JSON.parse(raw);
      } catch {
        d = {error: r.status === 404 ? "This server has no transcription yet (restart it with the new code)." : raw};
      }
      if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`);
      console.log(`[Transcribe] ${d.text!.length} characters from ${d.model}`);
      setText(d.text!);
      setMsg({kind: "ok", text: `Done in ${((Date.now() - started) / 1000).toFixed(1)} s with ${d.model}. Check the text, fix anything misheard, then copy it.`});
    } catch (e) {
      setMsg({kind: "err", text: `Transcription failed: ${(e as Error).message}`});
    } finally {
      setBusy(false);
    }
  };

  const copy = async (what: string, label: string) => {
    try {
      await navigator.clipboard.writeText(what);
      setMsg({kind: "ok", text: `${label} copied.`});
    } catch {
      setMsg({kind: "err", text: "The browser did not allow copying: select the text and copy it by hand."});
    }
  };

  return (
    <div className="desk">
      <div className="win">
        <div className="title">
          <span className="ticon" aria-hidden="true" />
          <span style={{flex: 1}}>Transcribe a recording</span>
          <a href="/editor.html" style={{color: "#fff", fontSize: 13}}>
            Skip to the editor ›
          </a>
        </div>
        <div className="body">
          <div className="group">
            <span className="gtitle">1. The recording</span>
            <label className={`drop${over ? " over" : ""}`} onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={drop} style={{cursor: "pointer"}}>
              <input type="file" accept=".webm,audio/webm,video/webm,audio/*,.m4a,.mp3,.wav,.ogg,.mp4" hidden onChange={(e) => pick(e.target.files?.[0])} />
              {file ? (
                <b>
                  {file.name} ({(file.size / 1e6).toFixed(1)} MB)
                </b>
              ) : (
                <>
                  <b>Drop the WebM recording here</b> or tap to choose it
                </>
              )}
              <div className="hint">WebM first; MP3, M4A, WAV and OGG work too. Up to {MAX_MB} MB.</div>
            </label>
            <div className="row">
              <button className="btn go" onClick={run} disabled={!file || busy}>
                {busy ? "Transcribing..." : "Transcribe"}
              </button>
              {msg.text && <span className={msg.kind}>{msg.text}</span>}
            </div>
          </div>

          <div className="group">
            <span className="gtitle">2. The text</span>
            <textarea className="code" value={text} onChange={(e) => setText(e.target.value)} placeholder="The transcript appears here. You can also type or paste one." spellCheck={false} />
            <div className="row">
              <button className="btn" onClick={() => copy(text, "The text")} disabled={!text.trim()}>
                Copy text
              </button>
              <button className="btn" onClick={() => copy(promptWith(text), "The JSON prompt with the transcript")} disabled={!text.trim()}>
                Copy with the JSON prompt
              </button>
            </div>
            <span className="hint">"Copy with the JSON prompt" gives the whole prompt for the AI chat with this transcript already in it; fill in the dancer's name at the top.</span>
          </div>

          <div className="row" style={{justifyContent: "flex-end"}}>
            <a className="btn go" href="/editor.html">
              Continue to the comic editor ›
            </a>
          </div>
        </div>
        <div className="sbar">
          <VersionTag style={{whiteSpace: "normal", fontSize: 12}} />
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById("root")!).render(<Transcribe />);
