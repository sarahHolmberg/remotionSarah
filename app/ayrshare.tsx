// app/ayrshare.tsx
// NEW FILE: the "Send to Ayrshare" panel of the preview tab, shown after an export (replaces the Buffer panel).
// Pick the networks, write the caption (with the @names to tag), post now or at a time; the server (server/ayrshare.mjs)
// uploads the exported video to Ayrshare and creates the post.

import {useEffect, useState} from "react";

type Result = {platform: string; ok: boolean; message: string};

// the server answers JSON; the Codespace dev server has no Ayrshare endpoints and answers plain text
const json = async (r: Response) => {
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return {error: r.status === 404 ? "Sending to Ayrshare only works on the website (Cloud Run), not in the Codespace." : t};
  }
};

export const SendToAyrshare = () => {
  const [accounts, setAccounts] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [now, setNow] = useState(false);
  const [at, setAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [results, setResults] = useState<Result[]>([]);

  useEffect(() => {
    console.log("[Ayrshare] loading the connected networks");
    fetch("/api/ayrshare/accounts")
      .then(json)
      .then((d: {accounts?: string[]; error?: string}) => {
        if (d.error) throw new Error(d.error);
        console.log(`[Ayrshare] networks: ${d.accounts!.join(", ") || "none"}`);
        setAccounts(d.accounts!);
        setPicked(d.accounts!); // all ticked to start with
        if (!d.accounts!.length) setMsg("No networks connected in Ayrshare yet.");
      })
      .catch((e) => setMsg(e.message));
  }, []);

  const send = async () => {
    const when = now ? "now" : new Date(at).toISOString();
    setBusy(true);
    setResults([]);
    setMsg("Sending: uploading the video, then creating the post...");
    console.log(`[Ayrshare] sending to ${picked.join(", ")}, when ${when}`);
    try {
      const d = await json(await fetch("/api/ayrshare/send", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({text, platforms: picked, when})}));
      if (d.error) throw new Error(d.error);
      setResults(d.results);
      setMsg(d.results.every((r: Result) => r.ok) ? `Done (${d.status}).` : "Some networks failed, see below.");
    } catch (e) {
      setMsg(`Sending failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const box = {background: "#1e1830", padding: 10, borderRadius: 6, width: "min(520px, 92vw)", fontSize: 13, display: "flex", flexDirection: "column" as const, gap: 8};
  return (
    <div style={box}>
      <b>Send to Ayrshare</b>
      {accounts === null && !msg && <span>Loading your connected networks...</span>}
      {accounts?.map((a) => (
        <label key={a} style={{display: "flex", gap: 8, alignItems: "center"}}>
          <input type="checkbox" checked={picked.includes(a)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, a] : p.filter((x) => x !== a)))} />
          {a}
        </label>
      ))}
      {!!accounts?.length && (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Caption, with the people to tag as @names" style={{width: "100%", boxSizing: "border-box", fontSize: 14}} />
          <div style={{display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center"}}>
            <label style={{display: "flex", gap: 4, alignItems: "center"}}>
              <input type="radio" checked={!now} onChange={() => setNow(false)} />
              At
            </label>
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} disabled={now} />
            <label style={{display: "flex", gap: 4, alignItems: "center"}}>
              <input type="radio" checked={now} onChange={() => setNow(true)} />
              Post now
            </label>
          </div>
          <button onClick={send} disabled={busy || !picked.length || (!now && !at)} style={{padding: "8px 16px", fontSize: 14, alignSelf: "flex-start", cursor: busy ? "wait" : "pointer"}}>
            {busy ? "Sending..." : `Send to ${picked.length} network${picked.length === 1 ? "" : "s"}`}
          </button>
        </>
      )}
      {msg && <span>{msg}</span>}
      {results.map((r, i) => (
        <span key={i} style={{color: r.ok ? "#8fe08f" : "#ff7a7a", wordBreak: "break-word"}}>
          {r.ok ? "✓" : "✕"} {r.platform}: {r.message}
        </span>
      ))}
    </div>
  );
};
