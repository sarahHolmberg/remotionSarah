// app/parrot.tsx
// NEW FILE: Parrot, the transcript-to-script site (served at /parrot/ by server/tasks.mjs, its own password).
// One task at a time, one big button that changes with the step:
//   1. Copy for AI    -> the prompt + this task's transcript go to the clipboard together
//   2. Paste answer   -> the AI's JSON is read from the clipboard and checked right away (rules + the video's length)
//   3. Send           -> sends by itself after a 3-second countdown (Cancel stops it); the next task comes up
// When the AI's answer has problems: "Copy fix request" copies a ready-made message to paste back into the same chat.
// The transcript, the script and the problems are never shown on screen: they only travel through the clipboard.
/// <reference types="vite/client" />
import {useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import PROMPT from "../prompts/transcript-to-json.md?raw";
import {applyDefaults, validateAgainstVideo, validateSpec, type Spec} from "../src/spec";
import {mailRenderStarted} from "./mail";

declare const __APP_VERSION__: string;
type Task = {taskId: string; name: string; transcript: string; durationSeconds: number};
type Step = "loading" | "empty" | "copy" | "paste" | "manual" | "fix" | "ready" | "sending" | "error";
const COUNTDOWN = 3;
// the AI apps: after copying, one tap opens the chosen one (on a phone the link opens its app when it's installed)
const AIS = [
  {name: "ChatGPT", url: "https://chatgpt.com/"},
  {name: "Claude", url: "https://claude.ai/new"},
  {name: "Gemini", url: "https://gemini.google.com/app"},
];
const AI_KEY = "parrot-ai";

// one id per phone, so a task opened here stays held for this phone (and not for another person) for a while
const client = (() => {
  try {
    const k = "parrot-client";
    const v = localStorage.getItem(k) || Math.random().toString(36).slice(2, 12);
    localStorage.setItem(k, v);
    return v;
  } catch {
    return Math.random().toString(36).slice(2, 12);
  }
})();

// the AI's answer -> the script, or the problems with it. AIs like to wrap JSON in ``` fences or add a sentence; both are ignored.
const check = (text: string, seconds: number): {spec?: Spec; problems: string[]} => {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return {problems: ["The answer has no JSON in it. Ask the AI for the complete JSON only."]};
  let raw: any;
  try {
    raw = JSON.parse(text.slice(a, b + 1));
  } catch (e) {
    return {problems: [`The JSON can't be read (${(e as Error).message}). It may be cut off: ask for the complete JSON.`]};
  }
  const problems = [...validateSpec(raw).errors];
  if (!problems.length) problems.push(...validateAgainstVideo(raw as Spec, seconds));
  if (!raw.username) problems.push('"username" is missing: the dancer\'s Instagram username, without the @.');
  if (typeof raw.caption !== "string") problems.push('"caption" is missing: the post caption text ("" if there is none).');
  return problems.length ? {problems} : {spec: raw as Spec, problems};
};
const fixRequest = (problems: string[]) =>
  `Your JSON has these problems:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nFix them and answer with the complete corrected JSON only, nothing else.`;

const Parrot = () => {
  const [task, setTask] = useState<Task | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [held, setHeld] = useState(0); // waiting ones someone else is working on
  const [step, setStep] = useState<Step>("loading");
  const [problems, setProblems] = useState<string[]>([]);
  const [spec, setSpec] = useState<Spec | null>(null);
  const [left, setLeft] = useState(COUNTDOWN);
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState("");
  const timer = useRef<number | null>(null);
  const [ai, setAi] = useState(() => {
    try {
      return AIS.find((a) => a.name === localStorage.getItem(AI_KEY)) ?? AIS[0];
    } catch {
      return AIS[0];
    }
  });
  const pickAi = (a: (typeof AIS)[number]) => {
    setAi(a);
    try {
      localStorage.setItem(AI_KEY, a.name);
    } catch {
      /* remembered for this visit only */
    }
  };

  const say = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(""), 1800);
  };
  const buzz = () => navigator.vibrate?.(40);

  const next = async () => {
    setStep("loading");
    setProblems([]);
    setSpec(null);
    try {
      const r = await fetch(`/parrot/api/next?client=${client}`, {cache: "no-store"});
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? r.status);
      setWaiting(d.waiting);
      setHeld(d.held ?? 0);
      setTask(d.task);
      setStep(d.task ? "copy" : "empty");
    } catch (e) {
      setMessage(`Can't reach the server (${(e as Error).message}).`);
      setStep("error");
    }
  };
  useEffect(() => void next(), []);
  // nothing to do: look again every 30 s
  useEffect(() => {
    if (step !== "empty") return;
    const t = window.setInterval(next, 30000);
    return () => window.clearInterval(t);
  }, [step]);

  const copyForAI = async () => {
    if (!task) return;
    try {
      await navigator.clipboard.writeText(`${PROMPT.trimEnd()}\n${task.transcript}\n`);
      buzz();
      say("Copied: paste it into your AI");
      setStep("paste");
    } catch {
      setMessage("This browser didn't allow copying. Try again, or open Parrot in Safari or Chrome.");
      setStep("error");
    }
  };

  const take = (text: string) => {
    if (!task) return;
    const r = check(text, task.durationSeconds);
    if (r.spec) {
      setSpec(r.spec);
      setLeft(COUNTDOWN);
      setStep("ready");
    } else {
      setProblems(r.problems);
      setStep("fix");
    }
  };
  const pasteAnswer = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return say("The clipboard is empty: copy the AI's answer first");
      take(text);
    } catch {
      setStep("manual"); // reading the clipboard isn't allowed here: paste into a box instead
    }
  };
  const copyFix = async () => {
    try {
      await navigator.clipboard.writeText(fixRequest(problems));
      buzz();
      say("Copied: paste it into the same chat");
      setStep("paste");
    } catch {
      setStep("paste");
    }
  };

  const send = async () => {
    if (!task || !spec) return;
    if (timer.current) window.clearInterval(timer.current);
    setStep("sending");
    try {
      const r = await fetch(`/parrot/api/script?task=${encodeURIComponent(task.taskId)}&client=${client}`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(applyDefaults(spec))});
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? `the server answered ${r.status}`);
      buzz();
      mailRenderStarted("Parrot, Send", {Task: task.name, "Task id": task.taskId}); // the server starts rendering it now
      say(`Sent ${task.name} 🦜`);
      next();
    } catch (e) {
      console.error("[Parrot] send failed", e);
      setMessage("Couldn't send it. Check your connection and try again.");
      setStep("error");
    }
  };
  // ready: send by itself when the countdown ends
  useEffect(() => {
    if (step !== "ready") return;
    timer.current = window.setInterval(() => setLeft((s) => s - 1), 1000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [step]);
  useEffect(() => {
    if (step === "ready" && left <= 0) void send();
  }, [left, step]);
  const cancel = () => {
    if (timer.current) window.clearInterval(timer.current);
    setStep("paste");
  };

  const skip = async () => {
    if (!task) return;
    await fetch(`/parrot/api/skip?task=${encodeURIComponent(task.taskId)}&client=${client}`, {method: "POST"}).catch(() => undefined);
    say("Skipped: it goes to the back of the line");
    next();
  };

  const stepNo = step === "copy" ? 1 : step === "ready" || step === "sending" ? 3 : 2;

  // the one big button for each step
  const button =
    step === "copy" ? <button className="big" onClick={copyForAI}>Copy for AI</button>
    : step === "paste" ? <button className="big" onClick={pasteAnswer}>Paste the answer</button>
    : step === "fix" ? <button className="big alt" onClick={copyFix}>Copy fix request</button>
    : step === "ready" ? <button className="big" onClick={send}>Send now ({left})</button>
    : step === "sending" ? <button className="big" disabled><span className="ring" />Sending</button>
    : step === "error" ? <button className="big" onClick={next}>Try again</button>
    : step === "empty" ? <button className="big" onClick={next}>Check again</button>
    : null;

  return (
    <>
      {toast && <div className="toast" role="status">{toast}</div>}
      <div className="desk">
        <div className="win">
          {/* Windows XP window: blue title bar with the waiting count, beige body */}
          <div className="title">
            <span className="ticon" aria-hidden="true">🦜</span>
            <span className="ttext">Parrot</span>
            <span className="count">{waiting ? `${waiting} waiting` : ""}</span>
            <span className="cb" aria-hidden="true">_</span>
            <span className="cb x" aria-hidden="true">✕</span>
          </div>
      <main className="main">
        {step === "loading" ? (
          <div className="center"><p className="hint">Finding the next one…</p></div>
        ) : step === "empty" ? (
          <div className="center">
            <div className="emoji">🎉</div>
            <p className="say">Nothing to do right now.</p>
            <p className="hint">{held ? `Someone else is working on the last ${held === 1 ? "one" : held}. ` : ""}New ones show up here by themselves.</p>
          </div>
        ) : step === "error" ? (
          <div className="center">
            <div className="emoji">🙈</div>
            <p className="say">{message}</p>
          </div>
        ) : (
          task && (
            <div className="card" aria-live="polite">
              <div className="dots" aria-label={`Step ${stepNo} of 3`}>
                {[1, 2, 3].map((n) => <span key={n} className={n <= stepNo ? "on" : ""} />)}
              </div>
              <h1 className="name">{task.name}</h1>
              {step === "copy" && <p className="say">Copy it, then paste it into your AI app (ChatGPT, Claude, Gemini…).</p>}
              {step === "paste" && (
                <>
                  <p className="say">Paste it into {ai.name}. When it answers, copy its whole answer and come back.</p>
                  <a className="open" href={ai.url} target="_blank" rel="noopener noreferrer">
                    Open {ai.name} ↗
                  </a>
                  <div className="row">
                    {AIS.filter((a) => a.name !== ai.name).map((a) => (
                      <button key={a.name} className="link" onClick={() => pickAi(a)}>Use {a.name}</button>
                    ))}
                    <button className="link" onClick={copyForAI}>Copy again</button>
                  </div>
                </>
              )}
              {step === "manual" && (
                <>
                  <p className="say">Long-press the box below and tap Paste.</p>
                  {/* the pasted answer is never shown: it is checked the moment it lands, and the box empties again */}
                  <textarea
                    className="blind"
                    value=""
                    onChange={(e) => e.target.value.trim() && take(e.target.value)}
                    onPaste={(e) => {
                      e.preventDefault();
                      const t = e.clipboardData.getData("text");
                      if (t.trim()) take(t);
                    }}
                    placeholder="Paste here"
                    aria-label="Paste the AI's answer here"
                    autoFocus
                    spellCheck={false}
                  />
                </>
              )}
              {step === "fix" && (
                <>
                  <p className="say">The AI's answer needs a fix.</p>
                  <p className="hint">Tap Copy fix request, paste it into the same chat, then copy the new answer and come back.</p>
                  <div className="row">
                    <button className="link" onClick={() => setStep("paste")}>Paste a different answer</button>
                  </div>
                </>
              )}
              {(step === "ready" || step === "sending") && (
                <>
                  <p className="say ok">✓ Looks good</p>
                  <p className="hint">{step === "ready" ? "Sending by itself in a moment." : "Sending…"}</p>
                  {step === "ready" && (
                    <div className="row">
                      <button className="link" onClick={cancel}>Cancel</button>
                    </div>
                  )}
                </>
              )}
              {(step === "copy" || step === "paste") && (
                <div className="row">
                  <button className="link" onClick={skip}>Skip this one</button>
                </div>
              )}
            </div>
          )
        )}
        <p className="ver">v{__APP_VERSION__}</p>
      </main>
        </div>
      </div>
      {button && <div className="dock">{button}</div>}
    </>
  );
};

createRoot(document.getElementById("root")!).render(<Parrot />);
