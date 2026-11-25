// app/errors.tsx
// NEW FILE: an error log in the browser, and a "Copy error details" button that copies it as a short technical report
// (to paste to the developer). It holds what failed, the server's answer (status + the start of its text), the version,
// the browser and the time; never the transcripts or scripts. Used by Parrot (app/parrot.tsx) and the comic editor
// (task board, Studio, full editor). The log survives a reload in the same tab (sessionStorage).
import {useState} from "react";

declare const __APP_VERSION__: string;
type Entry = {time: string; where: string; message: string; status?: number; body?: string; url?: string};
const KEY = "error-log";
const MAX = 25;

const read = (): Entry[] => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
};
let entries: Entry[] = read();

export const logError = (where: string, e: unknown, extra: Partial<Entry> = {}) => {
  const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  entries = [...entries, {time: new Date().toISOString(), where, message, ...extra}].slice(-MAX);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* kept in memory only */
  }
  console.error(`[Errors] ${where}: ${message}`, extra);
};
export const hasErrors = () => entries.length > 0;

// fetch that writes every failure into the log: no answer at all, or an answer that isn't OK (with its status and text)
export const apiFetch = async (url: string, init: RequestInit | undefined, where: string): Promise<Response> => {
  try {
    const r = await fetch(url, init);
    if (!r.ok) {
      const body = await r.clone().text().catch(() => "");
      logError(where, new Error(`the server answered HTTP ${r.status}`), {status: r.status, body: body.slice(0, 600), url});
    }
    return r;
  } catch (e) {
    logError(where, e, {url, body: navigator.onLine ? "the browser says it is online" : "the browser says it is OFFLINE"});
    throw e;
  }
};

// errors nobody caught (a crash in the page) go into the log too
export const installErrorLog = () => {
  window.addEventListener("error", (e) => logError("page error", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => logError("unhandled promise", e.reason));
};

export const errorReport = () =>
  [
    `ERROR REPORT (${location.pathname})`,
    `version: ${typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "?"}`,
    `time now: ${new Date().toISOString()}`,
    `browser: ${navigator.userAgent}`,
    `online: ${navigator.onLine}, standalone app: ${matchMedia("(display-mode: standalone)").matches}`,
    `errors (${entries.length}, oldest first):`,
    ...(entries.length ? entries : [{time: "-", where: "-", message: "no errors recorded"} as Entry]).map(
      (x, i) => `${i + 1}. ${x.time} [${x.where}] ${x.message}${x.status ? ` | status ${x.status}` : ""}${x.url ? ` | ${x.url.replace(/client=[^&]+/, "client=…")}` : ""}${x.body ? `\n   answer: ${x.body.replace(/\s+/g, " ")}` : ""}`
    ),
  ].join("\n");

// the button: copies the report, says "Copied ✓" for a moment
export const CopyErrorsButton = ({className = "link", label = "Copy error details"}: {className?: string; label?: string}) => {
  const [done, setDone] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(errorReport());
      setDone("Copied ✓");
    } catch {
      setDone("Couldn't copy");
    }
    window.setTimeout(() => setDone(""), 1800);
  };
  return (
    <button type="button" className={className} onClick={copy}>
      {done || label}
    </button>
  );
};
