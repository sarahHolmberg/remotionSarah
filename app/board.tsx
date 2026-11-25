// app/board.tsx
// NEW FILE: the editor page's main view: the task board. Every video the grid player sent (server/tasks.mjs):
//   Incomplete: waiting for Parrot (no script yet), then "Rendering" once Parrot sent the script, or failed (Retry)
//   Complete:   rendered and scheduled (with the posting time), then posted (with the link)
// The Studio (make one by hand) and the full editor ("See background") open in the side pane (app/editor.tsx).
import {useEffect, useState} from "react";
import {mailRenderStarted} from "./mail";
import {VersionTag} from "./version";

type Task = {taskId: string; name: string; status: string; receivedAt: string; scriptAt?: string; doneAt?: string; publishAt?: string; permalink?: string; error?: string; durationSeconds?: number};

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", {timeZone: "Europe/Stockholm", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"}) : "");
const BADGE: Record<string, [string, string]> = {
  needs_script: ["Waiting for Parrot", "wait"],
  queued: ["Rendering…", "run"],
  making: ["Rendering…", "run"],
  failed: ["Failed", "fail"],
  scheduled: ["Scheduled", "ok"],
  posted: ["Posted", "ok"],
};

const Card = ({t, onRetry}: {t: Task; onRetry: (t: Task) => void}) => {
  const [label, kind] = BADGE[t.status] ?? [t.status, "wait"];
  return (
    <li className="tcard">
      <div className="trow">
        <b className="tname">{t.name}</b>
        <span className={`badge ${kind}`}>{label}</span>
      </div>
      <span className="hint">
        {t.taskId} · received {when(t.receivedAt)}
        {t.durationSeconds ? ` · ${t.durationSeconds.toFixed(1)} s` : ""}
      </span>
      {t.status === "scheduled" && <span>Posts {when(t.publishAt)} (Reel + Story)</span>}
      {t.status === "posted" && (
        <span>
          Posted {when(t.publishAt)}
          {t.permalink && (
            <>
              {" · "}
              <a href={t.permalink} target="_blank" rel="noopener noreferrer">
                open the Reel
              </a>
            </>
          )}
        </span>
      )}
      {(t.status === "queued" || t.status === "making") && <span className="hint">Script from Parrot {when(t.scriptAt)}; then it schedules itself.</span>}
      {t.status === "failed" && (
        <div className="trow">
          <span className="terr" title={t.error}>
            {t.error}
          </span>
          <button className="btn" onClick={() => onRetry(t)}>
            Retry
          </button>
        </div>
      )}
    </li>
  );
};

export const TaskBoard = ({onStudio}: {onStudio: () => void}) => {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [counts, setCounts] = useState({open: 0, finished: 0});
  const [msg, setMsg] = useState("");
  const [at, setAt] = useState("");

  const load = () =>
    fetch("/api/tasks", {cache: "no-store"})
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`the server answered ${r.status}`))))
      .then((d) => {
        setTasks(d.tasks ?? []);
        setCounts(d.counts ?? {open: 0, finished: 0});
        setMsg("");
        setAt(new Date().toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit", second: "2-digit"}));
      })
      .catch((e) => setMsg(`Can't load the tasks: ${e.message}`));
  useEffect(() => {
    void load();
    const t = setInterval(load, 15000); // new videos and finished renders show up by themselves
    return () => clearInterval(t);
  }, []);

  const retry = async (t: Task) => {
    const r = await fetch(`/api/tasks/${encodeURIComponent(t.taskId)}/retry`, {method: "POST"}).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (d?.status === "queued") mailRenderStarted("Editor, Retry", {Task: t.name, "Task id": t.taskId});
    void load();
  };

  const done = (t: Task) => t.status === "scheduled" || t.status === "posted";
  const open = tasks?.filter((t) => !done(t)) ?? [];
  const finished = tasks?.filter(done) ?? [];
  const waiting = open.filter((t) => t.status === "needs_script").length;
  const rendering = open.filter((t) => t.status === "queued" || t.status === "making").length;
  const failed = open.filter((t) => t.status === "failed").length;

  return (
    <div className="desk">
      <div className="win board">
        <div className="title">
          <span className="ticon" aria-hidden="true" />
          <span className="ttext">Tasks</span>
          <button className="btn" onClick={onStudio} style={{minHeight: 30, padding: "2px 12px", fontSize: 13}}>
            Studio ▸
          </button>
        </div>
        <div className="toolbar">
          <span>
            <b>{waiting}</b> waiting for Parrot · <b>{rendering}</b> rendering · <b>{failed}</b> failed · <b>{counts.finished}</b> complete
          </span>
          <button className="btn" onClick={load}>
            Refresh
          </button>
        </div>
        {msg && <div className="note err" style={{padding: "0 12px"}}>{msg}</div>}
        <div className="body cols2">
          <section className="group">
            <span className="gtitle">Incomplete ({open.length})</span>
            {tasks === null ? (
              <span className="hint">Loading…</span>
            ) : open.length ? (
              <ul className="tlist">
                {open.map((t) => (
                  <Card key={t.taskId} t={t} onRetry={retry} />
                ))}
              </ul>
            ) : (
              <span className="hint">Nothing waiting. New videos from the grid player show up here.</span>
            )}
          </section>
          <section className="group">
            <span className="gtitle">Complete ({counts.finished})</span>
            {tasks === null ? (
              <span className="hint">Loading…</span>
            ) : finished.length ? (
              <ul className="tlist">
                {finished.map((t) => (
                  <Card key={t.taskId} t={t} onRetry={retry} />
                ))}
              </ul>
            ) : (
              <span className="hint">Nothing scheduled yet.</span>
            )}
          </section>
        </div>
        <div className="sbar">
          <span>{at ? `Updated ${at} · checks every 15 s` : ""}</span>
          <VersionTag style={{fontSize: 11}} />
        </div>
      </div>
    </div>
  );
};
