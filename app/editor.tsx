// app/editor.tsx
// NOT NEW: existing file, changed (adds the Grid size slider, JSON grid.size)

// Tab 1: pick the video and the picture, paste the JSON. Valid JSON is saved and sent to tab 2.
import {useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import {applyDefaults, BUBBLE_SCALE, CAPTION_ZOOM, CHAIN, IMPACT, NAME_ZOOM, OUTRO, POP_SOUND, PROFILE_KEYS, validateSpec, type Spec} from "../src/spec";
import {CHANNEL, DEFAULT_TEXT, savePicture, saveVideo, STORE_KEY} from "./shared";
import {VersionTag} from "./version";

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

// A slider with its name on the left and its value on the right (XP look comes from the existing .row / .file classes)
const Slider = ({label, value, min, max, step, show, onChange, disabled}: {label: string; value: number; min: number; max: number; step: number; show: (v: number) => string; onChange: (v: number) => void; disabled: boolean}) => (
  <div className="row" style={{flexWrap: "nowrap"}}>
    <span style={{width: 104, flex: "none"}}>{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{flex: 1, minWidth: 0, height: 32}}
    />
    <span className="file" style={{flex: "none", width: 64, padding: "8px 2px", textAlign: "center"}}>{show(value)}</span>
  </div>
);

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

  // the JSON as an object (null while it is not readable): the sliders read from it and write into it
  const obj: Record<string, any> | null = (() => {
    try {
      const o = JSON.parse(text);
      return o && typeof o === "object" && !Array.isArray(o) ? o : null;
    } catch {
      return null;
    }
  })();
  const scaleOf = (k: "normal" | "name"): number => {
    const v = obj?.bubbleScale?.[k];
    return typeof v === "number" && Number.isFinite(v) ? v : BUBBLE_SCALE.default;
  };
  // write a changed JSON back into the box (pasted on one line -> stays on one line)
  const save = (next: Record<string, any>) => setText(JSON.stringify(next, null, text.includes("\n") ? 2 : 0));
  const setScale = (k: "normal" | "name", v: number) => {
    if (!obj) return;
    console.log(`[Editor] bubble size slider: ${k} = ${v.toFixed(2)}`);
    save({...obj, bubbleScale: {normal: scaleOf("normal"), name: scaleOf("name"), [k]: v}});
  };

  // the zoom at every normal bubble: checkbox = enabled, slider = percent
  const cz = obj?.captionZoom;
  const zoomOn = !!cz && cz.enabled !== false; // captionZoom missing = off, present without "enabled" = on
  const zoomPercent = typeof cz?.percent === "number" && Number.isFinite(cz.percent) ? cz.percent : CAPTION_ZOOM.defaultPercent;
  const zoomSeconds = typeof cz?.seconds === "number" && Number.isFinite(cz.seconds) ? cz.seconds : CAPTION_ZOOM.defaultSeconds;
  const setZoom = (patch: {enabled?: boolean; percent?: number}) => {
    if (!obj) return;
    console.log(`[Editor] zoom: ${JSON.stringify(patch)}`);
    save({...obj, captionZoom: {enabled: zoomOn, percent: zoomPercent, seconds: zoomSeconds, ...patch}});
  };

  // the pop sound: checkbox = enabled, slider = offsetSeconds (negative = earlier, positive = later)
  const ps = obj?.popSound;
  const popOn = !!ps && ps.enabled !== false; // popSound missing = off, present without "enabled" = on
  const popOffset = typeof ps?.offsetSeconds === "number" && Number.isFinite(ps.offsetSeconds) ? ps.offsetSeconds : POP_SOUND.defaultOffset;
  const setPop = (patch: {enabled?: boolean; offsetSeconds?: number}) => {
    if (!obj) return;
    console.log(`[Editor] pop sound: ${JSON.stringify(patch)}`);
    save({...obj, popSound: {enabled: popOn, offsetSeconds: popOffset, ...patch}});
  };

  // the chain: checkbox = enabled, slider = windowSeconds (bubbles starting within this time of a group's first bubble stay up together)
  const chn = obj?.chain;
  const chainOn = !!chn && chn.enabled !== false; // chain missing = off, present without "enabled" = on
  const chainWindow = typeof chn?.windowSeconds === "number" && Number.isFinite(chn.windowSeconds) ? chn.windowSeconds : CHAIN.defaultSeconds;
  const setChain = (patch: {enabled?: boolean; windowSeconds?: number}) => {
    if (!obj) return;
    console.log(`[Editor] chain: ${JSON.stringify(patch)}`);
    save({...obj, chain: {enabled: chainOn, windowSeconds: chainWindow, ...patch}});
  };

  // name zoom, outro and impact: on by default, so the sliders show the same defaults the preview and the export use
  const eff = obj ? applyDefaults(obj as Spec) : null;
  const setNameZoom = (percent: number) => obj && eff && save({...obj, nameZoom: {...eff.nameZoom!, percent}});
  const setOutro = (secondsBeforeEnd: number) => obj && eff && save({...obj, outro: {...eff.outro!, secondsBeforeEnd}});
  const setImpact = (size: number) => obj && eff && save({...obj, impact: {...eff.impact!, size}});

  // profiles: every slider setting under a name, kept on the server (GitHub when it has a token, see server/profiles.mjs)
  const [profiles, setProfiles] = useState<string[]>([]);
  const [profilesWhere, setProfilesWhere] = useState("");
  const [picked, setPicked] = useState("");
  const [newName, setNewName] = useState("");
  const [profileMsg, setProfileMsg] = useState("");
  const refreshProfiles = () =>
    fetch("/api/profiles")
      .then((r) => r.json())
      .then((d: {profiles?: string[]; where?: string; error?: string}) => {
        if (d.error) throw new Error(d.error);
        console.log(`[Editor] profiles: ${d.profiles?.join(", ") || "none"} (in ${d.where})`);
        setProfiles(d.profiles ?? []);
        setProfilesWhere(d.where ?? "");
        setPicked((p) => p || d.profiles?.[0] || "");
      })
      .catch((e) => setProfileMsg(`Cannot list the profiles: ${e.message}`));
  useEffect(() => void refreshProfiles(), []);
  const loadProfile = async () => {
    if (!obj || !picked) return;
    try {
      const r = await fetch(`/api/profiles/${encodeURIComponent(picked)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? r.status);
      const next = {...obj};
      // a profile setting replaces the JSON's, but keeps what belongs to this video (impact.at / impact.captions)
      PROFILE_KEYS.forEach((k) => (d[k] === undefined ? delete next[k] : (next[k] = k === "impact" ? {...obj.impact, ...d[k]} : d[k])));
      save(next);
      console.log(`[Editor] loaded profile ${picked}`);
      setProfileMsg(`Loaded "${picked}".`);
    } catch (e) {
      setProfileMsg(`Cannot load "${picked}": ${(e as Error).message}`);
    }
  };
  const saveProfile = async () => {
    const name = newName.trim().replace(/\s+/g, "-");
    if (!eff || !name) return;
    const data = Object.fromEntries(PROFILE_KEYS.filter((k) => eff[k] !== undefined).map((k) => [k, eff[k]]));
    data.impact = {size: eff.impact?.size ?? IMPACT.defaultSize}; // the size only: where the bursts go belongs to each video
    try {
      setProfileMsg(`Saving "${name}"...`);
      const r = await fetch(`/api/profiles/${encodeURIComponent(name)}`, {method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(data)});
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? r.status);
      console.log(`[Editor] saved profile ${name}`, data);
      setProfileMsg(`Saved "${name}".`);
      setNewName("");
      setPicked(name);
      refreshProfiles();
    } catch (e) {
      setProfileMsg(`Cannot save "${name}": ${(e as Error).message}`);
    }
  };

  const valid = errors.length === 0;
  const [jsonOpen, setJsonOpen] = useState(() => !valid); // the JSON box starts folded away when there already is good JSON
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

          <div className="body cols">
            {/* left: the files and the JSON */}
            <div className="stack">
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

              <details className="group" open={jsonOpen} onToggle={(e) => setJsonOpen(e.currentTarget.open)}>
                <summary className="fold">
                  3. JSON <span className={`ico ${valid ? "ok" : "err"}`}>{valid ? "✓" : "✕"}</span> <span className="hint">{jsonOpen ? "tap to fold away" : "tap to show / paste"}</span>
                </summary>
                <textarea
                  className="code"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  placeholder="Paste the JSON text here"
                />
              </details>

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

            {/* right: every setting (all saved in the JSON) */}
            <div className="stack">
              {!obj && (
                <div className="msg">
                  <span className="ico warn">!</span>
                  <span>The settings need readable JSON (step 3).</span>
                </div>
              )}

              <div className="group">
                <span className="gtitle">Profiles</span>
                <div className="row">
                  <select className="file" value={picked} onChange={(e) => setPicked(e.target.value)} disabled={!profiles.length}>
                    {profiles.length ? profiles.map((p) => <option key={p}>{p}</option>) : <option value="">No profiles saved yet</option>}
                  </select>
                  <button className="btn" onClick={loadProfile} disabled={!obj || !picked}>
                    Load
                  </button>
                </div>
                <div className="row">
                  <input className="file" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name for the current settings" maxLength={40} style={{fontSize: 16}} />
                  <button className="btn" onClick={saveProfile} disabled={!obj || !newName.trim()}>
                    Save
                  </button>
                </div>
                <span className="hint">{profileMsg || (profilesWhere && `Kept in ${profilesWhere}`)}</span>
              </div>

              <div className="group">
                <span className="gtitle">Bubbles</span>
                <Slider label="Grid size" value={obj?.grid?.size ?? 15} min={2} max={26} step={1} show={(v) => `${v}x${v}`} onChange={(v) => obj && save({...obj, grid: {...obj.grid, size: v}})} disabled={!obj} />
                <span className="hint">The cells in the JSON (and the grid in the preview) go from A1 to {String.fromCharCode(64 + (obj?.grid?.size ?? 15))}{obj?.grid?.size ?? 15}.</span>
                <Slider label="Normal bubbles" value={scaleOf("normal")} min={BUBBLE_SCALE.min} max={BUBBLE_SCALE.max} step={BUBBLE_SCALE.step} show={(v) => `x${v.toFixed(2)}`} onChange={(v) => setScale("normal", v)} disabled={!obj} />
                <Slider label="Name bubble" value={scaleOf("name")} min={BUBBLE_SCALE.min} max={BUBBLE_SCALE.max} step={BUBBLE_SCALE.step} show={(v) => `x${v.toFixed(2)}`} onChange={(v) => setScale("name", v)} disabled={!obj} />
                <Slider label="Impact burst" value={eff?.impact?.size ?? IMPACT.defaultSize} min={IMPACT.min} max={IMPACT.max} step={IMPACT.step} show={(v) => (v > 0 ? `x${v.toFixed(2)}` : "off")} onChange={setImpact} disabled={!obj} />
                <span className="hint">
                  Impact burst, as big as this many bubble widths:{" "}
                  {eff?.impact?.at?.length ? `at ${eff.impact.at.map((x) => `${x.cell} (${x.from}s)`).join(", ")}` : ""}
                  {eff?.impact?.captions?.length ? ` behind caption ${eff.impact.captions.join(", ")}` : ""}
                  {!eff?.impact?.at?.length && !eff?.impact?.captions ? "behind the first normal bubble" : ""}.
                </span>
              </div>

              <div className="group">
                <span className="gtitle">Chain</span>
                <label className="row" style={{cursor: obj ? "pointer" : "default", flexWrap: "nowrap"}}>
                  <input type="checkbox" checked={chainOn} disabled={!obj} onChange={(e) => setChain({enabled: e.target.checked})} style={{width: 22, height: 22, flex: "none"}} />
                  <span>Bubbles that start close together stay up together, linked</span>
                </label>
                <Slider label="Chain window" value={chainWindow} min={CHAIN.min} max={CHAIN.max} step={CHAIN.step} show={(v) => `${v.toFixed(1)} s`} onChange={(v) => setChain({windowSeconds: v})} disabled={!obj || !chainOn} />
              </div>

              <div className="group">
                <span className="gtitle">Zoom</span>
                <label className="row" style={{cursor: obj ? "pointer" : "default", flexWrap: "nowrap"}}>
                  <input type="checkbox" checked={zoomOn} disabled={!obj} onChange={(e) => setZoom({enabled: e.target.checked})} style={{width: 22, height: 22, flex: "none"}} />
                  <span>Small zoom at every normal bubble (in, out, in...)</span>
                </label>
                <Slider label="Zoom amount" value={zoomPercent} min={CAPTION_ZOOM.min} max={CAPTION_ZOOM.max} step={CAPTION_ZOOM.step} show={(v) => `${v.toFixed(1)}%`} onChange={(v) => setZoom({percent: v})} disabled={!obj || !zoomOn} />
                <Slider label="Name zoom" value={eff?.nameZoom?.percent ?? NAME_ZOOM.defaultPercent} min={NAME_ZOOM.min} max={NAME_ZOOM.max} step={NAME_ZOOM.step} show={(v) => (v > 0 ? `${v.toFixed(1)}%` : "off")} onChange={setNameZoom} disabled={!obj} />
              </div>

              <div className="group">
                <span className="gtitle">Pop sound and outro</span>
                <label className="row" style={{cursor: obj ? "pointer" : "default", flexWrap: "nowrap"}}>
                  <input type="checkbox" checked={popOn} disabled={!obj} onChange={(e) => setPop({enabled: e.target.checked})} style={{width: 22, height: 22, flex: "none"}} />
                  <span>Pop sound at the first bubble</span>
                </label>
                <Slider label="Sound offset" value={popOffset} min={POP_SOUND.min} max={POP_SOUND.max} step={POP_SOUND.step} show={(v) => `${v > 0 ? "+" : ""}${Math.round(v * 1000)} ms`} onChange={(v) => setPop({offsetSeconds: v})} disabled={!obj || !popOn} />
                <Slider label="Outro starts" value={eff?.outro?.secondsBeforeEnd ?? OUTRO.defaultSeconds} min={OUTRO.min} max={OUTRO.max} step={OUTRO.step} show={(v) => (v > 0 ? `${v.toFixed(1)} s` : "off")} onChange={setOutro} disabled={!obj} />
                <span className="hint">Outro: seconds before the end the "{eff?.outro?.text ?? OUTRO.defaultText}" bubble comes (with the pop sound).</span>
              </div>
            </div>
          </div>

          <div className="sbar">
            <span>JSON: {valid ? "valid" : `${errors.length} problem(s)`}</span>
            <span>4. Press Preview (bottom left)</span>
          </div>
          <div style={{padding: "4px 10px", borderTop: "1px solid var(--line)", textAlign: "center", fontWeight: 700, whiteSpace: "normal"}}>
            <VersionTag style={{whiteSpace: "normal", fontSize: 12}} />
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