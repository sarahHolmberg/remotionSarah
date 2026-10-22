// app/editor.tsx
// NOT NEW: existing file, changed (adds the picture picker for the name bubble; same XP look)

// Tab 1: pick the video and the picture, paste the JSON. Valid JSON is saved and sent to tab 2.
import {useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import {validateSpec} from "../src/spec";
import {CHANNEL, DEFAULT_TEXT, savePicture, saveVideo, STORE_KEY} from "./shared";

console.log("[Editor] 1. file loaded");

const showCrash = (msg: string) => {
  console.error("[Editor] CRASH:", msg);
  const root = document.getElementById("root");
  if (root && !root.innerHTML) root.innerHTML = `<pre style="color:#ff7a7a;padding:24px;white-space:pre-wrap">${msg}</pre>`;
};
window.addEventListener("error", (e) => showCrash(e.message));
window.addEventListener("unhandledrejection", (e) => showCrash(String(e.reason)));

const check = (text: string): {errors: string[]; warnings: string[]} => {
  if (!text.trim()) return {errors: ["No JSON yet. Paste it in the box above."], warnings: []};
  try {
    return validateSpec(JSON.parse(text));
  } catch (e) {
    return {errors: [`JSON syntax: ${(e as Error).message}`], warnings: []};
  }
};

const Editor = () => {
  console.log("[Editor] 2. component rendering");
  const [text, setText] = useState(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      console.log(`[Editor] start text from ${saved ? "localStorage (last good JSON)" : "DEFAULT_TEXT"}`);
      return saved ?? DEFAULT_TEXT;
    } catch (e) {
      console.error("[Editor] localStorage failed", e);
      return DEFAULT_TEXT;
    }
  });
  const [videoName, setVideoName] = useState("No video chosen (the preview uses public/<video.file>)");
  const [pictureName, setPictureName] = useState("No picture chosen (the picture bubble stays empty)");
  const [fileErr, setFileErr] = useState("");
  const ch = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    console.log(`[Editor] 3. opening channel "${CHANNEL}"`);
    ch.current = new BroadcastChannel(CHANNEL);
    return () => ch.current?.close();
  }, []);

  const {errors, warnings} = check(text);

  // every change of the text: check it; if valid, save it and send it to tab 2
  useEffect(() => {
    console.log(`[Editor] 4. text changed: ${text.length} chars, ${errors.length} error(s), ${warnings.length} warning(s)`);
    errors.forEach((e) => console.log("[Editor]   error:", e));
    warnings.forEach((w) => console.warn("[Editor]   warning:", w));
    if (errors.length) {
      console.log("[Editor]   not sent: tab 2 keeps the last good version");
      return;
    }
    try {
      localStorage.setItem(STORE_KEY, text);
      console.log("[Editor]   saved as last good JSON");
    } catch (e) {
      console.error("[Editor]   cannot save the JSON in localStorage", e);
    }
    ch.current?.postMessage({type: "json", text});
    console.log("[Editor]   sent {type: json}");
  }, [text]);

  const pickVideo = async (f: File | undefined) => {
    if (!f) return;
    console.log(`[Editor] video picked: ${f.name}, ${(f.size / 1e6).toFixed(1)} MB`);
    setFileErr("");
    try {
      await saveVideo(f);
      setVideoName(`${f.name} (${(f.size / 1e6).toFixed(1)} MB)`);
      ch.current?.postMessage({type: "video"});
      console.log("[Editor]   sent {type: video}");
    } catch (e) {
      console.error("[Editor] saving the video failed", e);
      setFileErr(`Could not store the video in the browser (${(e as Error)?.message ?? e}). Try a smaller file.`);
    }
  };

  const pickPicture = async (f: File | undefined) => {
    if (!f) return;
    console.log(`[Editor] picture picked: ${f.name}, ${(f.size / 1e3).toFixed(0)} KB, type "${f.type}"`);
    setFileErr("");
    try {
      await savePicture(f);
      setPictureName(`${f.name} (${(f.size / 1e3).toFixed(0)} KB)`);
      ch.current?.postMessage({type: "picture"});
      console.log("[Editor]   sent {type: picture}");
    } catch (e) {
      console.error("[Editor] saving the picture failed", e);
      setFileErr(`Could not store the picture in the browser (${(e as Error)?.message ?? e}).`);
    }
  };

  const valid = errors.length === 0;
  console.log(`[Editor] render: json ${valid ? "valid" : "invalid"}, video "${videoName}", picture "${pictureName}"`);
  return (
    <>
      <div className="desk">
        <div className="win">
          <div className="title">
            <span className="ticon" aria-hidden="true" />
            <span className="ttext">Comic editor</span>
            <span className="cb" aria-hidden="true">_</span>
            <span className="cb" aria-hidden="true">▢</span>
            <span className="cb x" aria-hidden="true">✕</span>
          </div>

          <div className="body">
            <div className="group">
              <span className="gtitle">1. Video</span>
              <div className="row">
                <label className="btn">
                  Browse...
                  <input type="file" accept="video/*" hidden onChange={(e) => pickVideo(e.target.files?.[0])} />
                </label>
                <span className="file">{videoName}</span>
              </div>
            </div>

            <div className="group">
              <span className="gtitle">2. Picture for the name bubble</span>
              <div className="row">
                <label className="btn">
                  Browse...
                  <input type="file" accept="image/*" hidden onChange={(e) => pickPicture(e.target.files?.[0])} />
                </label>
                <span className="file">{pictureName}</span>
              </div>
              {fileErr && (
                <div className="msg">
                  <span className="ico err">✕</span>
                  <span>{fileErr}</span>
                </div>
              )}
            </div>

            <div className="group grow">
              <span className="gtitle">3. Paste the JSON here</span>
              <textarea
                className="code"
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                placeholder="Paste the JSON text here"
              />
            </div>

            <div className="group">
              <span className="gtitle">Messages</span>
              <div className="status">
                {errors.map((e, i) => (
                  <div className="msg" key={`e${i}`}>
                    <span className="ico err">✕</span>
                    <span>{e}</span>
                  </div>
                ))}
                {warnings.map((w, i) => (
                  <div className="msg" key={`w${i}`}>
                    <span className="ico warn">!</span>
                    <span>{w}</span>
                  </div>
                ))}
                {valid && (
                  <div className="msg">
                    <span className="ico ok">✓</span>
                    <span>JSON is valid and sent to the preview.</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="sbar">
            <span>JSON: {valid ? "valid" : `${errors.length} problem(s)`}</span>
            <span>4. Press Preview (bottom left)</span>
          </div>
        </div>
      </div>

      <div className="task">
        <a className="start" href="/preview.html" target="_blank" rel="noopener" onClick={() => console.log("[Editor] opening the preview tab")}>
          <span className="logo" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          Preview
        </a>
        <span className="taskbtn">Comic editor</span>
      </div>
    </>
  );
};

const rootEl = document.getElementById("root");
console.log(`[Editor] 0. mounting (root element ${rootEl ? "found" : "MISSING"})`);
createRoot(rootEl!).render(<Editor />);