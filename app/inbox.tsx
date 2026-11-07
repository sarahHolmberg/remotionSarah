// app/inbox.tsx
// NEW FILE: the bar at the top of the comic editor: the oldest video link the grid player sent (server/inbox.mjs),
// i.e. the video being worked on now. Click it to open/download; "Done → next" removes it and shows the next one.
import {useEffect, useState} from "react";

type Item = {id: string; url: string; title: string; receivedAt: string};

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
    </div>
  );
};
