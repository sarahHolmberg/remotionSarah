// app/buffer.tsx
// NEW FILE: the "Send to Buffer" panel of the preview tab, shown after an export.
// Pick the channels, write the caption (with the @names to tag), choose when; the server (server/buffer.mjs) puts the
// exported video in the Cloud Storage bucket and creates one Buffer post per channel.

import {useEffect, useState} from "react";

type Channel = {id: string; name: string; service: string};
type Result = {channel: string; ok: boolean; message: string};
type When = "queue" | "now" | "at";

// the server answers JSON; the Codespace dev server has no Buffer endpoints and answers plain text
const json = async (r: Response) => {
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return {error: r.status === 404 ? "Sending to Buffer only works on the website (Cloud Run), not in the Codespace." : t};
  }
};

export const SendToBuffer = () => {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [when, setWhen] = useState<When>("queue");
  const [at, setAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [results, setResults] = useState<Result[]>([]);

  useEffect(() => {
    console.log("[Buffer] loading the channels");
    fetch("/api/buffer/channels")
      .then(json)
      .then((d: {channels?: Channel[]; error?: string}) => {
        if (d.error) throw new Error(d.error);
        console.log(`[Buffer] channels: ${d.channels!.map((c) => `${c.service} ${c.name}`).join(", ")}`);
        setChannels(d.channels!);
        setPicked(d.channels!.map((c) => c.id)); // all channels ticked to start with
      })
      .catch((e) => setMsg(e.message));
  }, []);

  const send = async () => {
    const whenValue = when === "at" ? new Date(at).toISOString() : when;
    setBusy(true);
    setResults([]);
    setMsg("Sending: copying the video, then creating the posts...");
    console.log(`[Buffer] sending to ${picked.length} channel(s), when ${whenValue}`);
    try {
      const d = await json(await fetch("/api/buffer/send", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({text, channelIds: picked, when: whenValue})}));
      if (d.error) throw new Error(d.error);
      setResults(d.results);
      setMsg(d.results.every((r: Result) => r.ok) ? "Done." : "Some posts failed, see below.");
    } catch (e) {
      setMsg(`Sending failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const box = {background: "#1e1830", padding: 10, borderRadius: 6, width: "min(520px, 92vw)", fontSize: 13, display: "flex", flexDirection: "column" as const, gap: 8};
  return (
    <div style={box}>
      <b>Send to Buffer (TikTok and the other networks)</b>
      {channels === null && !msg && <span>Loading your Buffer channels...</span>}
      {channels?.map((c) => (
        <label key={c.id} style={{display: "flex", gap: 8, alignItems: "center"}}>
          <input type="checkbox" checked={picked.includes(c.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
          {c.service}: {c.name}
        </label>
      ))}
      {channels && (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Caption, with the people to tag as @names" style={{width: "100%", boxSizing: "border-box", fontSize: 14}} />
          <div style={{display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center"}}>
            {(["queue", "now", "at"] as When[]).map((w) => (
              <label key={w} style={{display: "flex", gap: 4, alignItems: "center"}}>
                <input type="radio" checked={when === w} onChange={() => setWhen(w)} />
                {w === "queue" ? "Next free slot in the queue" : w === "now" ? "Post now" : "At"}
              </label>
            ))}
            {when === "at" && <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />}
          </div>
          <button onClick={send} disabled={busy || !picked.length || (when === "at" && !at)} style={{padding: "8px 16px", fontSize: 14, alignSelf: "flex-start", cursor: busy ? "wait" : "pointer"}}>
            {busy ? "Sending..." : `Send to ${picked.length} channel${picked.length === 1 ? "" : "s"}`}
          </button>
        </>
      )}
      {msg && <span>{msg}</span>}
      {results.map((r, i) => (
        <span key={i} style={{color: r.ok ? "#8fe08f" : "#ff7a7a"}}>
          {r.ok ? "✓" : "✕"} {r.channel}: {r.message}
        </span>
      ))}
    </div>
  );
};
