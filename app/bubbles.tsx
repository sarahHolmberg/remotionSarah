// app/bubbles.tsx
// NEW FILE: edit the bubbles right under the video in the preview.
//  - timeline: one marker per bubble at its time; click = select it and jump there, drag = change its time
//  - the selected bubble: words, time (nudge buttons, "set to playhead"), cells (click the video to move the tail there,
//    Shift+click adds or removes a second cell), delete
//  - add a bubble at the playhead, and a list of all bubbles
// Every change goes into the JSON (onChange), so the editor's checks, profiles and the export see exactly the same thing.

import {useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject} from "react";
import type {PlayerRef} from "@remotion/player";
import type {Caption} from "../src/spec";

const r3 = (x: number) => Math.round(x * 1000) / 1000;

// keep the captions valid after a time changed: in time order, each one's "to" before the next one's "from"
export const retime = (caps: Caption[]): Caption[] => {
  const out = caps.map((c) => ({...c})).sort((a, b) => a.from - b.from);
  out.forEach((c, i) => {
    const next = out[i + 1];
    let to = c.to;
    if (next) to = Math.min(to, r3(next.from - 0.01));
    c.to = Math.max(to, r3(c.from + 0.01));
    if (typeof c.out === "number" && (c.out <= c.to || (next && c.out > next.from))) c.out = "default"; // an exact "out" that no longer fits
  });
  return out;
};

type Props = {
  captions: Caption[];
  seconds: number;
  fps: number;
  player: RefObject<PlayerRef | null>;
  playerKey: string; // changes when the Player is made anew (new video): listen to the new one
  selected: number | null;
  onSelect: (id: number | null) => void;
  onChange: (captions: Caption[]) => void;
};

export const BubbleEditor = ({captions, seconds, fps, player, playerKey, selected, onSelect, onChange}: Props) => {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [drag, setDrag] = useState<{id: number; t: number} | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{x: number; moved: boolean} | null>(null);

  // follow the Player: where the playhead is, and whether it plays
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: {detail: {frame: number}}) => setFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
    };
  }, [playerKey]);

  const now = frame / fps;
  const seek = (t: number) => player.current?.seekTo(Math.max(0, Math.round(t * fps)));
  const timeAt = (clientX: number) => {
    const b = bar.current!.getBoundingClientRect();
    return r3(Math.min(seconds - 0.05, Math.max(0, ((clientX - b.left) / b.width) * seconds)));
  };
  const moved = (c: Caption, from: number): Caption => {
    const f = r3(Math.min(seconds - 0.05, Math.max(0, from)));
    return {...c, from: f, to: r3(f + Math.max(c.to - c.from, 0.05)), out: typeof c.out === "number" ? r3(c.out + f - c.from) : c.out};
  };
  const change = (id: number, fn: (c: Caption) => Caption) => onChange(retime(captions.map((c) => (c.id === id ? fn(c) : c))));

  // timeline: press on a marker = select (and drag to move it), press on the empty bar = jump there
  const press = (e: ReactPointerEvent<HTMLDivElement>, c: Caption) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = {x: e.clientX, moved: false};
    onSelect(c.id);
    setDrag({id: c.id, t: c.from});
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || !dragStart.current) return;
    if (Math.abs(e.clientX - dragStart.current.x) > 3) dragStart.current.moved = true;
    if (!dragStart.current.moved) return;
    const t = timeAt(e.clientX);
    setDrag({...drag, t});
    seek(t); // the video follows the marker, so you see the moment you drop it on
  };
  const release = (c: Caption) => {
    if (drag && dragStart.current?.moved) {
      console.log(`[Bubbles] #${c.id} dragged from ${c.from}s to ${drag.t}s`);
      change(c.id, (x) => moved(x, drag.t));
    } else seek(c.from);
    setDrag(null);
    dragStart.current = null;
  };

  const sel = captions.find((c) => c.id === selected);
  const add = () => {
    const id = Math.max(0, ...captions.map((c) => c.id)) + 1;
    const from = r3(now);
    console.log(`[Bubbles] add #${id} at ${from}s`);
    onChange(retime([...captions, {id, text: "new move", from, to: r3(from + 0.2), cells: [sel?.cells[0] ?? "J10"], mode: "center", out: "default"}]));
    onSelect(id);
  };
  const remove = (c: Caption) => {
    if (!confirm(`Delete bubble #${c.id} "${c.text}"?`)) return;
    console.log(`[Bubbles] delete #${c.id}`);
    onChange(captions.filter((x) => x.id !== c.id));
    onSelect(null);
  };

  const btn = {padding: "4px 8px", fontSize: 12, cursor: "pointer"};
  const row = {display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" as const};
  return (
    <div style={{width: "100%", display: "flex", flexDirection: "column", gap: 8, fontSize: 13}}>
      <div style={row}>
        <button style={btn} onClick={() => player.current?.toggle()}>
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <span style={{fontVariantNumeric: "tabular-nums"}}>
          {now.toFixed(2)} / {seconds.toFixed(2)} s
        </span>
        <span style={{flex: 1}} />
        <button style={btn} onClick={add}>
          + Bubble at {now.toFixed(2)} s
        </button>
      </div>

      {/* the timeline */}
      <div ref={bar} onPointerDown={(e) => seek(timeAt(e.clientX))} style={{position: "relative", height: 48, background: "#2a2240", borderRadius: 4, cursor: "pointer", touchAction: "none", userSelect: "none"}}>
        {captions.map((c, i) => {
          const t = drag?.id === c.id ? drag.t : c.from;
          const on = c.id === selected;
          return (
            <div
              key={c.id}
              onPointerDown={(e) => press(e, c)}
              onPointerMove={move}
              onPointerUp={() => release(c)}
              title={`#${c.id} ${c.text} (${t.toFixed(3)} s, ${c.cells.join("+")})`}
              style={{position: "absolute", left: `${(t / seconds) * 100}%`, top: i % 2 ? 25 : 3, transform: "translateX(-50%)", padding: "1px 6px", borderRadius: 9, fontSize: 11, fontWeight: 700, background: on ? "#f8b636" : "#e8e2f8", color: "#000", cursor: "grab", whiteSpace: "nowrap", zIndex: on ? 2 : 1}}
            >
              {c.id === 1 ? "name" : c.id}
            </div>
          );
        })}
        <div style={{position: "absolute", left: `${(now / seconds) * 100}%`, top: 0, bottom: 0, width: 2, background: "#ff5a5a", pointerEvents: "none"}} />
      </div>

      {/* the selected bubble */}
      {sel ? (
        <div style={{background: "#1e1830", padding: 8, borderRadius: 6, display: "flex", flexDirection: "column", gap: 6, border: "1px solid #f8b636"}}>
          <div style={row}>
            <b>
              Bubble #{sel.id}
              {sel.id === 1 ? " (name bubble)" : ""}
            </b>
            <span style={{flex: 1}} />
            <button style={btn} onClick={() => remove(sel)}>
              Delete
            </button>
            <button style={btn} onClick={() => onSelect(null)}>
              Done
            </button>
          </div>
          <input value={sel.text} onChange={(e) => change(sel.id, (c) => ({...c, text: e.target.value}))} placeholder="Words in the bubble" style={{fontSize: 14, padding: 4}} />
          <div style={row}>
            <span>Time</span>
            <input type="number" step={0.01} min={0} max={seconds} value={sel.from} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && change(sel.id, (c) => moved(c, e.target.valueAsNumber))} style={{width: 80, fontSize: 14}} />
            {[-0.1, -0.01, 0.01, 0.1].map((d) => (
              <button key={d} style={btn} onClick={() => change(sel.id, (c) => moved(c, c.from + d))}>
                {d > 0 ? "+" : ""}
                {d}
              </button>
            ))}
            <button style={btn} onClick={() => change(sel.id, (c) => moved(c, now))}>
              Set to playhead
            </button>
            <button style={btn} onClick={() => seek(sel.from)}>
              Go to
            </button>
          </div>
          <div style={row}>
            <span>Tail to</span>
            {sel.cells.map((cell) => (
              <span key={cell} style={{background: "#f8b636", color: "#000", borderRadius: 9, padding: "1px 8px", fontWeight: 700}}>
                {cell}
                {sel.cells.length > 1 && (
                  <button onClick={() => change(sel.id, (c) => ({...c, cells: c.cells.filter((x) => x !== cell)}))} style={{marginLeft: 4, border: 0, background: "none", cursor: "pointer", fontWeight: 700}}>
                    ✕
                  </button>
                )}
              </span>
            ))}
            <span style={{opacity: 0.75}}>Click a cell on the video to move the tail there, Shift+click to add or remove a second cell.</span>
          </div>
        </div>
      ) : (
        <span style={{opacity: 0.75}}>Click a marker on the timeline (or a bubble below) to edit it. Drag a marker to change its time.</span>
      )}

      {/* all bubbles */}
      <div style={{maxHeight: 180, overflow: "auto", display: "flex", flexDirection: "column", gap: 2}}>
        {captions.map((c) => (
          <div
            key={c.id}
            onClick={() => {
              onSelect(c.id);
              seek(c.from);
            }}
            style={{display: "flex", gap: 8, padding: "2px 6px", borderRadius: 4, cursor: "pointer", background: c.id === selected ? "#3a3060" : undefined}}
          >
            <span style={{width: 40, flex: "none", opacity: 0.7}}>{c.id === 1 ? "name" : `#${c.id}`}</span>
            <span style={{width: 60, flex: "none", fontVariantNumeric: "tabular-nums"}}>{c.from.toFixed(3)}</span>
            <span style={{width: 70, flex: "none"}}>{c.cells.join("+")}</span>
            <span style={{flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>{c.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
