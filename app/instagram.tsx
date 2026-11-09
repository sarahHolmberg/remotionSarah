// app/instagram.tsx
// NEW FILE: the "Post to Instagram" panel of the preview tab (server/instagram.mjs does the work).
// Every export goes out as BOTH a Reel (whole video: caption with @mentions, tag people, collaborators, cover frame) and a
// Story (the first 10 seconds), at the same time: the next free posting time, a chosen time, or now.
// The JSON's "caption" and "username" fill the caption and the people to tag. Below: the queue of upcoming posts (cancel, retry) and the last ones posted.

import {useEffect, useState} from "react";

type Job = {id: string; type: "REELS" | "STORIES"; caption: string; publishAt: string; status: "scheduled" | "publishing" | "posted" | "failed"; error?: string; permalink?: string; notes?: string[]};
type Queue = {slots: string[]; times: string[]; timeZone: string; jobs: Job[]};
type When = "slot" | "at" | "now";

// the server answers JSON; the Codespace dev server has no Instagram endpoints and answers plain text
const json = async (r: Response) => {
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return {error: r.status === 404 ? "Posting to Instagram only works on the website (Cloud Run), not in the Codespace." : t};
  }
};
const list = (s: string) => s.split(/[\s,]+/).filter(Boolean);

export const PostToInstagram = ({exported, seconds, startCaption, startTag}: {exported: boolean; seconds: number; startCaption?: string; startTag?: string}) => {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [caption, setCaption] = useState("");
  useEffect(() => void (startCaption && setCaption(startCaption)), [startCaption]); // the JSON's "caption" fills the box
  const [tags, setTags] = useState("");
  useEffect(() => void (startTag && setTags(`@${startTag.replace(/^@/, "")}`)), [startTag]); // the dancer is always tagged
  const [collabs, setCollabs] = useState("");
  const [cover, setCover] = useState(0);
  const [when, setWhen] = useState<When>("slot");
  const [at, setAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const show = (iso: string) => new Date(iso).toLocaleString("en-GB", {timeZone: queue?.timeZone ?? "Europe/Stockholm", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"});
  const load = () =>
    fetch("/api/instagram/queue")
      .then(json)
      .then((d) => {
        if (d.error) throw new Error(d.error);
        console.log(`[Instagram] queue: ${d.jobs.length} job(s), next free ${d.slots[0]}`);
        setQueue(d);
      })
      .catch((e) => setMsg(e.message));
  useEffect(() => void load(), []);

  const act = async (what: string, req: Promise<Response>) => {
    setBusy(true);
    setMsg(what);
    try {
      const d = await json(await req);
      if (d.error) throw new Error(d.error);
      return d;
    } catch (e) {
      setMsg(`${what.replace(/\.\.\.$/, "")} failed: ${(e as Error).message}`);
      return null;
    } finally {
      setBusy(false);
      load();
    }
  };

  const schedule = async () => {
    const body = {caption, userTags: list(tags), collaborators: list(collabs), coverSeconds: cover, when: when === "at" ? new Date(at).toISOString() : when};
    console.log("[Instagram] schedule", body);
    const d = await act(when === "now" ? "Posting: Instagram is processing the Reel, then the Story (up to a few minutes each)..." : "Scheduling...", fetch("/api/instagram/schedule", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}));
    if (!d) return;
    const jobs: Job[] = d.jobs ?? [];
    const name = (j: Job) => (j.type === "REELS" ? "Reel" : "Story");
    const failed = jobs.filter((j) => j.status === "failed");
    if (failed.length) setMsg(failed.map((j) => `${name(j)} failed: ${j.error}`).join(" · "));
    else setMsg((when === "now" ? `Posted: ${jobs.map((j) => `${name(j)} ${j.permalink ?? "done"}`).join(" · ")}` : `Reel + Story scheduled for ${show(jobs[0].publishAt)}.`) + jobs.flatMap((j) => j.notes ?? []).map((n) => ` ⚠ ${n}`).join(""));
    if (!failed.length) [setCaption, setCollabs].forEach((f) => f(""));
  };

  const box = {background: "#1e1830", padding: 10, borderRadius: 6, width: "min(560px, 92vw)", fontSize: 13, display: "flex", flexDirection: "column" as const, gap: 8};
  const input = {width: "100%", boxSizing: "border-box" as const, fontSize: 14};
  const upcoming = queue?.jobs.filter((j) => j.status !== "posted") ?? [];
  const posted = queue?.jobs.filter((j) => j.status === "posted").slice(-3).reverse() ?? [];
  return (
    <div style={box}>
      <b>Post to Instagram</b>
      {queue && (
        <>
          <span style={{opacity: 0.7}}>Posts both: a Reel (the whole video) and a Story (the first 10 seconds; Instagram's API gives Stories no caption or tags).</span>
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} maxLength={2200} placeholder="Caption, @mentions work here" style={input} />
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tag people (the dancer is required): @stella @noor" style={{...input, outline: list(tags).length ? undefined : "2px solid #ff7a7a"}} />
          <input value={collabs} onChange={(e) => setCollabs(e.target.value)} placeholder="Collaborators (up to 3, they get an invite): @mirrors.dance" style={input} />
          <label style={{display: "flex", gap: 8, alignItems: "center"}}>
            Cover frame
            <input type="range" min={0} max={Math.max(0, Math.floor(seconds * 10) / 10)} step={0.1} value={cover} onChange={(e) => setCover(Number(e.target.value))} style={{flex: 1}} />
            <span style={{width: 110, flex: "none"}}>{cover > 0 ? `${cover.toFixed(1)} s` : "Instagram picks"}</span>
          </label>
          <div style={{display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center"}}>
            <label style={{display: "flex", gap: 4, alignItems: "center"}}>
              <input type="radio" checked={when === "slot"} onChange={() => setWhen("slot")} />
              Next free time{queue.slots[0] ? ` (${show(queue.slots[0])})` : ""}
            </label>
            <label style={{display: "flex", gap: 4, alignItems: "center"}}>
              <input type="radio" checked={when === "at"} onChange={() => setWhen("at")} />
              At
            </label>
            {when === "at" && <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />}
            <label style={{display: "flex", gap: 4, alignItems: "center"}}>
              <input type="radio" checked={when === "now"} onChange={() => setWhen("now")} />
              Now
            </label>
          </div>
          <button onClick={schedule} disabled={busy || !exported || !list(tags).length || (when === "at" && !at)} style={{padding: "8px 16px", fontSize: 14, alignSelf: "flex-start", cursor: busy ? "wait" : "pointer"}}>
            {!exported ? "Export the video first" : !list(tags).length ? "Tag the dancer first" : busy ? "Working..." : when === "now" ? "Post Reel + Story now" : "Schedule Reel + Story"}
          </button>
        </>
      )}
      {msg && <span style={{wordBreak: "break-word"}}>{msg}</span>}

      {queue && (
        <div style={{display: "flex", flexDirection: "column", gap: 4, borderTop: "1px solid #3a3150", paddingTop: 8}}>
          <span style={{opacity: 0.7}}>
            Posting times: {queue.times.join(", ")} ({queue.timeZone}). Coming up: {upcoming.length || "nothing"}
          </span>
          {upcoming.map((j) => (
            <div key={j.id} style={{display: "flex", gap: 8, alignItems: "center", color: j.status === "failed" ? "#ff7a7a" : undefined}}>
              <span style={{width: 130, flex: "none"}}>{show(j.publishAt)}</span>
              <span style={{flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}} title={j.error ?? j.caption}>
                {j.type === "REELS" ? "Reel" : "Story"} · {j.status === "failed" ? `failed: ${j.error}` : j.status === "publishing" ? "posting now..." : j.caption || "(no caption)"}
              </span>
              {j.status === "failed" && (
                <button disabled={busy} onClick={() => act("Retrying: Instagram is processing the video...", fetch(`/api/instagram/run?job=${j.id}`, {method: "POST"})).then((d) => d && setMsg(d.status === "posted" ? `Posted: ${d.permalink ?? "done"}` : `Still failing: ${d.error}`))}>
                  Retry
                </button>
              )}
              {j.status !== "publishing" && (
                <button disabled={busy} onClick={() => confirm(`Cancel the ${j.type === "REELS" ? "Reel" : "Story"} for ${show(j.publishAt)}?`) && act("Cancelling...", fetch(`/api/instagram/jobs/${j.id}`, {method: "DELETE"})).then((d) => d && setMsg("Cancelled."))}>
                  Cancel
                </button>
              )}
            </div>
          ))}
          {posted.map((j) => (
            <div key={j.id} style={{display: "flex", gap: 8, color: "#8fe08f"}}>
              <span style={{width: 130, flex: "none"}}>{show(j.publishAt)}</span>
              <a href={j.permalink} target="_blank" rel="noopener" style={{color: "#8fe08f", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>
                ✓ {j.type === "REELS" ? "Reel" : "Story"} posted · {j.notes?.length ? `⚠ ${j.notes.join(" ")} · ` : ""}{j.caption || "(no caption)"}
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
