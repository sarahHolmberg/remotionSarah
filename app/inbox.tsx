// app/inbox.tsx
// NEW FILE: the bar at the top of the comic editor: the oldest video link the grid player sent (server/inbox.mjs),
// i.e. the video being worked on now. Click it to open/download; "Done → next" removes it and shows the next one.
import {useEffect, useState} from "react";

type Item = {id: string; url: string; title: string; receivedAt: string};

// the transcription sites, opened next to the video link. A web page can't open an incognito window itself (browsers
// don't allow it), so these are plain links: right-click -> "Open link in incognito window", or the button opens both in new tabs.
const TRANSCRIBE = [
  {name: "TurboScribe", url: "https://turboscribe.ai/"},
  {name: "Uniscribe", url: "https://www.uniscribe.co/"},
];

export const InboxBar = () => {
  const [items, setItems] = useState<Item[] | null>(null);
  const [msg, setMsg] = useState("");
  const refresh = () =>
    fetch("/api/inbox")
      .then((r) => r.json())
      .then((d: {items?: Item[]; error?: string}) => {
        if (d.error) throw new Error(d.error);
        setItems(d.items ?? []);
        setMsg("");
      })
      .catch((e) => setMsg(`Cannot read the video inbox: ${e.message}`));
  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 30000); // the grid player sends now and then: look every 30 s
    return () => clearInterval(t);
  }, []);
  const done = async (id: string) => {
    if (!confirm("Mark this video as done and show the next one?")) return;
    await fetch(`/api/inbox/${id}`, {method: "DELETE"}).catch(() => undefined);
    void refresh();
  };
  const cur = items?.[0];
  const openBoth = () => TRANSCRIBE.forEach((t) => window.open(t.url, "_blank", "noopener,noreferrer")); // the 2nd tab needs pop-ups allowed for this site
  return (
    <div className="inbox">
      <b>Now working on:</b>
      {cur ? (
        <>
          <a href={cur.url} target="_blank" rel="noreferrer" title={cur.url}>
            {cur.title || cur.url}
          </a>
          <span className="hint">
            received {new Date(cur.receivedAt).toLocaleString()} · {items!.length - 1} more waiting
          </span>
          <button className="btn" onClick={() => done(cur.id)}>
            Done → next
          </button>
        </>
      ) : (
        <span className="hint">{msg || (items ? "no video links yet (the grid player sends them)" : "loading...")}</span>
      )}
      <span style={{flexBasis: "100%", height: 0}} />
      <b>Transcribe:</b>
      {TRANSCRIBE.map((t) => (
        <a key={t.url} href={t.url} target="_blank" rel="noopener noreferrer" title="Right-click → Open link in incognito window">
          {t.name}
        </a>
      ))}
      <button className="btn" onClick={openBoth} title="Opens both in new tabs (allow pop-ups for this site the first time)">
        Open both
      </button>
      <span className="hint">incognito: right-click a link → Open link in incognito window</span>
    </div>
  );
};
