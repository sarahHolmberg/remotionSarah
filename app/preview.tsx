// app/preview.tsx
// NOT NEW: existing file, changed (no sliders here any more: name zoom and outro moved to the editor tab, the JSON carries every setting)

// Tab 2: plays the video with the captions on top (the same ComicEdit that Remotion renders), updates live when the editor tab sends new JSON, a new video or a new picture.
import {Component, useEffect, useMemo, useState, type ReactNode} from "react";
import {createRoot} from "react-dom/client";
import {Player} from "@remotion/player";
import {getVideoMetadata} from "@remotion/media-utils";
import {staticFile} from "remotion";
import {ComicEdit} from "../src/ComicEdit";
import {applyDefaults, validateAgainstVideo, validateSpec, type Spec} from "../src/spec";
import {CHANNEL, DEFAULT_TEXT, loadPicture, loadVideo, STORE_KEY} from "./shared";
import {VersionTag} from "./version";

console.log("[Preview] 1. file loaded, all imports resolved");

// Any crash is written on the page, not only in the console
const showCrash = (where: string, msg: string) => {
  console.error(`[Preview] CRASH (${where}):`, msg);
  const root = document.getElementById("root");
  if (root) root.innerHTML = `<pre style="color:#ff7a7a;padding:24px;white-space:pre-wrap">Preview crashed (${where}):\n${msg}</pre>`;
};
window.addEventListener("error", (e) => showCrash("window error", `${e.message}\n${e.error?.stack ?? ""}`));
window.addEventListener("unhandledrejection", (e) => showCrash("unhandled promise", String((e.reason && e.reason.stack) || e.reason)));

// React render errors (what makes a page silently white) land here
class Boundary extends Component<{children: ReactNode}, {err: Error | null}> {
  state = {err: null as Error | null};
  static getDerivedStateFromError(err: Error) {
    return {err};
  }
  componentDidCatch(err: Error, info: {componentStack?: string | null}) {
    console.error("[Preview] React render error:", err, info.componentStack);
  }
  render() {
    if (this.state.err) return <pre style={{color: "#ff7a7a", padding: 24, whiteSpace: "pre-wrap"}}>Preview render error:{"\n"}{this.state.err.stack}</pre>;
    return this.props.children;
  }
}

type Meta = {w: number; h: number; seconds: number};
type Uploaded = {url: string; name: string};

// Files go to the server in pieces: Cloud Run refuses request bodies over 32 MB. Returns the name the server saved it as.
const UPLOAD_PIECE = 8 * 1024 * 1024;
const uploadFile = async (f: File, name: string): Promise<string> => {
  let saved = "";
  for (let offset = 0; offset === 0 || offset < f.size; offset += UPLOAD_PIECE) {
    const up = await fetch(`/api/upload?name=${encodeURIComponent(name)}&offset=${offset}`, {method: "POST", body: f.slice(offset, offset + UPLOAD_PIECE)});
    if (!up.ok) throw new Error(`upload of ${f.name} failed: ${up.status} ${await up.text()}`);
    saved = (await up.json()).file;
    console.log(`[Preview] upload ${f.name}: ${Math.min(offset + UPLOAD_PIECE, f.size)} of ${f.size} bytes`);
  }
  return saved;
};

const parse = (text: string): {spec?: Spec; errors: string[]} => {
  if (!text.trim()) {
    console.log("[Preview] parse: no JSON yet");
    return {errors: ["No JSON yet. Paste it in the editor tab."]};
  }
  try {
    const raw = JSON.parse(text);
    const {errors} = validateSpec(raw);
    console.log(`[Preview] parse: ${errors.length} problem(s)`);
    return errors.length ? {errors} : {spec: raw as Spec, errors};
  } catch (e) {
    console.log(`[Preview] parse: JSON syntax error: ${(e as Error).message}`);
    return {errors: [`JSON syntax: ${(e as Error).message}`]};
  }
};

const Preview = () => {
  console.log("[Preview] 3. component rendering");
  const [text, setText] = useState(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      console.log(`[Preview] start JSON from ${saved ? "localStorage (sent by the editor)" : "DEFAULT_TEXT"}`);
      return saved ?? DEFAULT_TEXT;
    } catch (e) {
      console.error("[Preview] localStorage failed", e);
      return DEFAULT_TEXT;
    }
  });
  const [uploaded, setUploaded] = useState<Uploaded | null>(null); // the video picked in the editor tab
  const [picture, setPicture] = useState<Uploaded | null>(null); // the picture picked in the editor tab
  const [checked, setChecked] = useState(false); // true once the browser-stored video has been looked for
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaErr, setMetaErr] = useState("");
  const [shown, setShown] = useState<{spec: Spec; meta: Meta; src: string} | null>(null); // last good version stays on screen
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState("");
  const [renderLog, setRenderLog] = useState<string[]>([]);

  const readUploaded = () => {
    console.log("[Preview] reading the stored video from IndexedDB...");
    return loadVideo()
      .then((f) => {
        console.log(`[Preview] stored video: ${f ? `${f.name}, ${(f.size / 1e6).toFixed(1)} MB, type "${f.type}"` : "none"}`);
        setUploaded(f ? {url: URL.createObjectURL(f), name: f.name} : null);
      })
      .catch((e) => console.error("[Preview] cannot read the stored video", e))
      .finally(() => {
        console.log("[Preview] stored-video check finished");
        setChecked(true);
      });
  };

  const readPicture = () => {
    console.log("[Preview] reading the stored picture from IndexedDB...");
    return loadPicture()
      .then((f) => {
        console.log(`[Preview] stored picture: ${f ? `${f.name}, ${(f.size / 1e3).toFixed(0)} KB, type "${f.type}"` : "none"}`);
        setPicture(f ? {url: URL.createObjectURL(f), name: f.name} : null);
      })
      .catch((e) => console.error("[Preview] cannot read the stored picture", e));
  };

  useEffect(() => {
    console.log(`[Preview] 4. effect: opening channel "${CHANNEL}", reading the stored video and picture`);
    readUploaded();
    readPicture();
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => {
      console.log(`[Preview] message from the editor: ${e.data.type}`);
      if (e.data.type === "json") setText(e.data.text);
      if (e.data.type === "video") readUploaded();
      if (e.data.type === "picture") readPicture();
    };
    return () => ch.close();
  }, []);
  useEffect(() => () => void (uploaded && URL.revokeObjectURL(uploaded.url)), [uploaded]);
  useEffect(() => () => void (picture && URL.revokeObjectURL(picture.url)), [picture]);

  const parsed = useMemo(() => parse(text), [text]);
  const file = parsed.spec?.video.file;
  const src = uploaded ? uploaded.url : checked && file ? staticFile(file) : ""; // public/ is only tried after the stored video was looked for
  console.log(`[Preview] source: ${uploaded ? `uploaded "${uploaded.name}"` : src ? `public/${file}` : "nothing yet"}, picture: ${picture ? picture.name : "none"}`);

  useEffect(() => {
    if (!src) {
      console.log("[Preview] no video source yet, skipping metadata");
      return;
    }
    let stale = false; // a newer source replaced this one: ignore its result
    console.log(`[Preview] 5. reading video metadata from ${src}`);
    setMeta(null);
    setMetaErr("");
    getVideoMetadata(src)
      .then((m) => {
        if (stale) return console.log("[Preview] ignoring a stale metadata result");
        console.log(`[Preview] video ${uploaded ? uploaded.name : file}: ${m.width}x${m.height}, ${m.durationInSeconds.toFixed(3)}s`);
        setMeta({w: m.width, h: m.height, seconds: m.durationInSeconds});
      })
      .catch((e) => {
        if (stale) return console.log("[Preview] ignoring a stale metadata error");
        console.error("[Preview] video metadata failed", e);
        setMetaErr(uploaded ? `Cannot read the chosen video (${e?.message ?? e})` : `No video chosen, and "${file}" is not in the public folder (${e?.message ?? e})`);
      });
    return () => {
      stale = true;
    };
  }, [src]);

  const videoErrors = parsed.spec && meta ? validateAgainstVideo(parsed.spec, meta.seconds) : [];
  const errors = [...parsed.errors, ...videoErrors, ...(metaErr ? [metaErr] : [])];
  if (errors.length) console.log(`[Preview] ${errors.length} problem(s) blocking an update:`, errors);

  useEffect(() => {
    if (parsed.spec && meta && errors.length === 0) {
      console.log("[Preview] 6. everything is valid, showing new version");
      setShown({spec: parsed.spec, meta, src});
    }
  }, [parsed.spec, meta, errors.length]);

  // Export: upload the picked video and picture, send the JSON that is on screen, stream the render log, then download comic.mp4
  const exportVideo = async () => {
    if (!shown || exporting) return;
    setExporting(true);
    setRenderLog([]);
    let spec = applyDefaults(shown.spec); // the JSON with the settings it does not have yet (the editor shows the same values)
    try {
      if (uploaded) {
        setExportMsg("Uploading the video...");
        const f = await loadVideo();
        if (f) {
          console.log(`[Preview] export: uploading video ${f.name} (${(f.size / 1e6).toFixed(1)} MB)`);
          const saved = await uploadFile(f, f.name);
          console.log(`[Preview] export: server saved the video as public/${saved}`);
          spec = {...spec, video: {file: saved}}; // the render reads public/<file>
        }
      } else console.log(`[Preview] export: no picked video, the render uses public/${spec.video.file}`);

      if (picture) {
        setExportMsg("Uploading the picture...");
        const pf = await loadPicture();
        if (pf) {
          console.log(`[Preview] export: uploading picture ${pf.name} (${(pf.size / 1e3).toFixed(0)} KB)`);
          const saved = await uploadFile(pf, "picture-" + pf.name);
          console.log(`[Preview] export: server saved the picture as public/${saved}`);
          spec = {...spec, picture: {file: saved}};
        }
      } else console.log(`[Preview] export: no picked picture${spec.picture ? `, the render uses public/${spec.picture.file}` : ""}`);

      setExportMsg("Rendering... (the first time can take a while)");
      console.log("[Preview] export: starting the render");
      const res = await fetch("/api/render", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(spec)});
      if (!res.ok || !res.body) throw new Error(`render request failed: ${res.status} ${await res.text()}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let done = false;
      let failed = "";
      const line = (l: string) => {
        console.log("[Preview] render:", l);
        setRenderLog((old) => [...old.slice(-11), l]);
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

      if (done) {
        console.log("[Preview] export: render done, downloading comic.mp4");
        setExportMsg("Done. Downloading comic.mp4");
        const a = document.createElement("a");
        a.href = `/api/download?t=${Date.now()}`;
        a.download = "comic.mp4";
        a.click();
      } else throw new Error(failed || "the render ended without finishing, see the log below");
    } catch (e) {
      console.error("[Preview] export failed", e);
      setExportMsg(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  if (!shown) {
    console.log(`[Preview] nothing to show yet (${errors.length ? "errors" : "still loading"})`);
    return (
      <div style={{padding: 24}}>
        {errors.length ? errors.map((e, i) => <p key={i} style={{color: "#ff7a7a"}}>{e}</p>) : "Loading the video..."}
        <p>
          <VersionTag style={{opacity: 0.6}} />
        </p>
      </div>
    );
  }
  const {spec, meta: m} = shown;
  console.log(`[Preview] 7. rendering the Player: ${m.w}x${m.h}, ${spec.fps}fps, ${Math.ceil(m.seconds * spec.fps)} frames`);
  return (
    <div style={{display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 8}}>
      {errors.length > 0 && (
        <div style={{color: "#ff7a7a", fontSize: 13}}>
          Not updated: {errors[0]}
          {errors.length > 1 ? ` (+${errors.length - 1} more, see the editor tab)` : ""}
        </div>
      )}
      <div style={{display: "flex", gap: 12, alignItems: "center"}}>
        <button onClick={exportVideo} disabled={exporting} style={{padding: "8px 16px", fontSize: 14, cursor: exporting ? "wait" : "pointer"}}>
          {exporting ? "Exporting..." : "Export video"}
        </button>
        {exportMsg && <span style={{fontSize: 13}}>{exportMsg}</span>}
      </div>
      {renderLog.length > 0 && (
        <pre style={{margin: 0, maxWidth: "90vw", maxHeight: 160, overflow: "auto", fontSize: 11, background: "#1e1830", padding: 8}}>{renderLog.join("\n")}</pre>
      )}
      <div style={{height: "92vh", aspectRatio: `${m.w} / ${m.h}`}}>
        <Player
          key={`${shown.src}-${m.w}x${m.h}-${spec.fps}`}
          component={ComicEdit}
          inputProps={{...applyDefaults(spec), videoSrc: shown.src, pictureSrc: picture?.url}}
          durationInFrames={Math.ceil(m.seconds * spec.fps)}
          fps={spec.fps}
          compositionWidth={m.w}
          compositionHeight={m.h}
          controls
          style={{width: "100%", height: "100%"}}
          errorFallback={({error}) => {
            console.error("[Preview] Player error:", error);
            return <span style={{color: "#ff7a7a"}}>Player error: {error.message}</span>;
          }}
        />
      </div>
      <VersionTag style={{opacity: 0.6}} />
    </div>
  );
};

const rootEl = document.getElementById("root");
console.log(`[Preview] 2. mounting (root element ${rootEl ? "found" : "MISSING: preview.html has no <div id=root>"})`);
createRoot(rootEl!).render(
  <Boundary>
    <Preview />
  </Boundary>
);