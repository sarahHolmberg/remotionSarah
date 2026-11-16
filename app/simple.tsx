// app/simple.tsx
// NEW FILE: the simple view, the first thing a new person sees. Three inputs (script, image, source) and one button; a progress
// bar while it works. Behind the scenes: upload the files, render the comic, schedule the Reel + Story (app/pipeline.ts,
// server/instagram.mjs). Everything it takes is saved where the full view ("See background", app/editor.tsx) reads it,
// so switching views keeps the work.
import {useEffect, useMemo, useRef, useState} from "react";
import {getVideoMetadata} from "@remotion/media-utils";
import {applyDefaults, validateAgainstVideo, validateSpec, type Spec} from "../src/spec";
import {CHANNEL, savePicture, saveVideo, STORE_KEY} from "./shared";
import {streamRender, uploadFile} from "./pipeline";
import {InboxBar} from "./inbox";
import {VersionTag} from "./version";

const STEPS = ["Preparing", "Composing", "Finishing"];
type Run = {step: number; pct: number; error?: string; doneAt?: string} | null;

// the script's problems, in plain words (the full view lists every detail)
const checkScript = (text: string): {spec?: Spec; problem?: string} => {
  if (!text.trim()) return {};
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return {problem: "This doesn't look like a complete script. Paste all of it, from the first { to the last }."};
  }
  const {errors} = validateSpec(raw);
  if (errors.length) return {problem: `The script has ${errors.length} problem${errors.length > 1 ? "s" : ""}: ${errors[0]}`};
  if (!raw.username) return {problem: 'The script needs a "username" (the person to tag).'};
  return {spec: raw as Spec};
};

const show = (iso: string) => new Date(iso).toLocaleString("en-GB", {timeZone: "Europe/Stockholm", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit"});

export const SimpleView = ({visible, onAdvanced}: {visible: boolean; onAdvanced: () => void}) => {
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [source, setSource] = useState<File | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [sourceProblem, setSourceProblem] = useState("");
  const [run, setRun] = useState<Run>(null);
  const ch = useRef<BroadcastChannel | null>(null);
  const made = useRef<Spec | null>(null); // the finished render's script: "Try again" after a failed last step only redoes that step
  const imageUrl = useMemo(() => (image ? URL.createObjectURL(image) : ""), [image]);
  useEffect(() => () => void (imageUrl && URL.revokeObjectURL(imageUrl)), [imageUrl]);

  useEffect(() => {
    ch.current = new BroadcastChannel(CHANNEL);
    return () => ch.current?.close();
  }, []);

  // back from the full view: take over the script as it was edited there
  useEffect(() => {
    if (!visible || !text) return;
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved && saved !== text) setText(saved);
    } catch {
      /* no storage: keep what is here */
    }
  }, [visible]);

  useEffect(() => {
    made.current = null; // a changed input needs a new render
  }, [text, source, image]);

  const {spec, problem} = checkScript(text);
  const lengthProblem = spec && seconds !== null ? validateAgainstVideo(spec, seconds)[0] : undefined;

  // a good script is saved where the full view reads it
  useEffect(() => {
    if (!spec) return;
    try {
      localStorage.setItem(STORE_KEY, text);
    } catch {
      /* the full view then starts from its last saved script */
    }
    ch.current?.postMessage({type: "json", text});
  }, [text, !!spec]);

  const pickImage = async (f?: File) => {
    if (!f) return;
    setImage(f);
    await savePicture(f)
      .then(() => ch.current?.postMessage({type: "picture"}))
      .catch((e) => console.error("[Simple] cannot store the image", e));
  };
  const pickSource = async (f?: File) => {
    if (!f) return;
    setSource(f);
    setSeconds(null);
    setSourceProblem("");
    const url = URL.createObjectURL(f);
    getVideoMetadata(url)
      .then((m) => setSeconds(m.durationInSeconds))
      .catch(() => setSourceProblem("This file can't be read. Try another one."))
      .finally(() => URL.revokeObjectURL(url));
    await saveVideo(f)
      .then(() => ch.current?.postMessage({type: "video"}))
      .catch((e) => console.error("[Simple] cannot store the source", e));
  };

  const busy = !!run && !run.error && !run.doneAt;
  const ready = !!spec && !!source && seconds !== null && !lengthProblem && !sourceProblem && !busy;

  // while composing, the bar creeps on slowly between the server's reports, so it always shows that it's working
  useEffect(() => {
    if (!busy || run?.step !== 1) return;
    const t = setInterval(() => setRun((r) => (r && r.step === 1 && !r.error && r.pct < 88 ? {...r, pct: r.pct + 0.25} : r)), 1000);
    return () => clearInterval(t);
  }, [busy, run?.step]);

  // leaving the page in the middle would stop the work
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const start = async () => {
    if (!spec || !source) return;
    const retryLast = run?.error && run.step === 2 && made.current;
    let step = 0;
    // never backwards: the bar may already have crept further than the server's last report
    const at = (s: number, pct: number) => {
      step = s;
      setRun((r) => ({step: s, pct: Math.min(100, Math.max(r && r.step === s ? r.pct : 0, pct))}));
    };
    try {
      let out: Spec = applyDefaults(spec);
      if (retryLast) out = made.current!;
      else {
        made.current = null;
        // 1. Preparing (0-25%): the files go to the server
        at(0, 1);
        const total = source.size + (image?.size ?? 0);
        out = {...out, video: {file: await uploadFile(source, source.name, (sent) => at(0, (sent / total) * 25))}};
        if (image) out = {...out, picture: {file: await uploadFile(image, "picture-" + image.name, (sent) => at(0, ((source.size + sent) / total) * 25))}};

        // 2. Composing (25-92%): the render, its log says how far it is
        at(1, 25);
        await streamRender(out, (l) => {
          const m = /(\d{1,3})%/.exec(l);
          if (m) at(1, 25 + Number(m[1]) * 0.67);
        });
        made.current = out;
      }

      // 3. Finishing (92-100%): the Reel + Story go into the next free posting time
      at(2, 94);
      const r = await fetch("/api/instagram/schedule", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({caption: out.caption ?? "", userTags: [out.username], collaborators: [], coverSeconds: 0, when: "slot"}),
      });
      const d = await r.json().catch(() => ({error: `the server answered ${r.status}`}));
      if (d.error) throw new Error(d.error);
      setRun({step: 3, pct: 100, doneAt: d.jobs?.[0]?.publishAt ?? ""});
    } catch (e) {
      console.error("[Simple] failed", e);
      setRun({step, pct: 0, error: (e as Error).message});
    }
  };

  const reset = () => {
    made.current = null;
    setText("");
    setImage(null);
    setSource(null);
    setSeconds(null);
    setRun(null);
  };

  return (
    <div className="desk simple" hidden={!visible}>
      <div className="win">
        <div className="title">
          <span className="ticon" aria-hidden="true" />
          <span className="ttext">Studio</span>
        </div>
        <InboxBar />

        <div className="body">
          {run?.doneAt !== undefined ? (
            <div className="done" role="status">
              <div className="big-ok" aria-hidden="true">
                ✓
              </div>
              <h2>All done</h2>
              <p>{run.doneAt ? `It's set for ${show(run.doneAt)}.` : "It's set."}</p>
              <button className="btn primary" onClick={reset}>
                Start a new one
              </button>
            </div>
          ) : (
            <>
              <section className="step">
                <label htmlFor="s-script" className="step-title">
                  <span className="num">1</span> Script
                  {spec && <span className="tick">✓</span>}
                </label>
                <textarea id="s-script" className="code" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the script here" spellCheck={false} disabled={busy} rows={5} />
                {problem && <span className="note err">{problem}</span>}
              </section>

              <section className="step">
                <span className="step-title">
                  <span className="num">2</span> Image <span className="hint">(optional)</span>
                  {image && <span className="tick">✓</span>}
                </span>
                <label className={`pick${image ? " has" : ""}`}>
                  <input type="file" accept="image/*" onChange={(e) => pickImage(e.target.files?.[0])} disabled={busy} />
                  {image ? (
                    <img src={imageUrl} alt="" />
                  ) : (
                    <span className="pick-ico" aria-hidden="true">
                      ＋
                    </span>
                  )}
                  <span className="pick-name">{image ? image.name : "Choose an image"}</span>
                </label>
              </section>

              <section className="step">
                <span className="step-title">
                  <span className="num">3</span> Source
                  {source && seconds !== null && !lengthProblem && <span className="tick">✓</span>}
                </span>
                <label className={`pick${source ? " has" : ""}`}>
                  <input type="file" accept="video/*" onChange={(e) => pickSource(e.target.files?.[0])} disabled={busy} />
                  <span className="pick-ico" aria-hidden="true">
                    {source ? "■" : "＋"}
                  </span>
                  <span className="pick-name">{source ? source.name : "Choose the source file"}</span>
                </label>
                {(sourceProblem || lengthProblem) && <span className="note err">{sourceProblem || `The script doesn't match this source: ${lengthProblem}`}</span>}
              </section>

              {run ? (
                <div className="progress" aria-live="polite">
                  <ol className="stepper">
                    {STEPS.map((s, i) => (
                      <li key={s} className={i < run.step ? "past" : i === run.step ? (run.error ? "fail" : "now") : ""}>
                        {s}
                      </li>
                    ))}
                  </ol>
                  {run.error ? (
                    <>
                      <span className="note err">Something went wrong while {STEPS[run.step].toLowerCase()}.</span>
                      <details>
                        <summary>Details</summary>
                        <span className="hint">{run.error}</span>
                      </details>
                      <button className="btn primary" onClick={start}>
                        Try again
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(run.pct)}>
                        <i style={{width: `${Math.max(3, run.pct)}%`}} />
                      </div>
                      <span className="hint">
                        {STEPS[run.step]}... {Math.round(run.pct)}% · keep this page open
                      </span>
                    </>
                  )}
                </div>
              ) : (
                <button className="btn primary" onClick={start} disabled={!ready}>
                  {ready
                    ? "Create"
                    : !spec
                      ? "Add the script to continue"
                      : !source
                        ? "Add the source to continue"
                        : seconds === null && !sourceProblem
                          ? "Reading the source..."
                          : "Fix the note above to continue"}
                </button>
              )}
            </>
          )}
        </div>

        <div className="sbar">
          <button className="linkbtn" onClick={onAdvanced} disabled={busy}>
            See background →
          </button>
          <VersionTag style={{fontSize: 11}} />
        </div>
      </div>
    </div>
  );
};
