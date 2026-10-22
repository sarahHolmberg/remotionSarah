import {useMemo} from "react";
import {AbsoluteFill, Easing, interpolate, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {loadFont} from "@remotion/google-fonts/Poppins"; // same font as before
import {cellRect} from "./gridCell";
import {VIDEO3} from "./NatashaEdit"; // same video file
import {blobAt, EXIT, schedule, type Blob, type Item} from "./bubbleTimeline";

const {fontFamily} = loadFont("normal", {weights: ["800"]});

// ---- Look (change here) ----
const N = 15; // 15x15 grid
const MAIN = "#130027"; // bubble fill
const ACC = "#D350EB"; // bubble outline, glow, accent letters
const TEXT = "#FFFFFF"; // letters (dark on dark would not read)
const ADV = 0.62; // letter width as a fraction of font size
const SIZE = 0.4; // text size in cells
const BALL = 0.25; // ball radius in cells
const FADE_OUT = 1; // seconds: the video fades to black at the very end
const ZOOM = {from: 3.55, to: 3.87, scale: 1.05, cells: ["G7", "J7", "G9", "J9"]};

// First six captions of NatashaEdit (same words, times, cells)
const ITEMS: Item[] = [
  {text: "Natasja Sandfeld", from: 0.893, to: 2.103, center: "J7"},
  {text: "swipe", from: 3.23, to: 3.433, center: "J8"},
  {text: "kick leg up", from: 3.551, to: 3.887, center: "K11"},
  {text: "turn head", from: 4.085, to: 4.433, center: "E6"},
  {text: "hands move up", from: 4.821, to: 5.058, center: "C8"},
  {text: "half turn", from: 5.785, to: 6.22, center: "I6"},
];
const SCH = schedule(ITEMS);

type P = {x: number; y: number};
const bez = (a: P, c: P, b: P, u: number): P => ({
  x: (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * c.x + u * u * b.x,
  y: (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * c.y + u * u * b.y,
});

export const NatashaBubble = () => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const t = frame / fps;
  const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

  const geo = useMemo(() => {
    const cw = width / N;
    const font = SIZE * cw;
    const lineH = font * 1.15;
    const items = ITEMS.map((it) => {
      const c = cellRect(it.center, width, height, N);
      const lines = it.text.split(" "); // one word per line
      const longest = Math.max(...lines.map((l) => l.length));
      const rx = ((longest * font * ADV) / 2) * 1.3 + font * 0.7; // bubble half-width
      const ry = ((lines.length * lineH) / 2) * 1.3 + font * 0.55; // bubble half-height
      const letters = lines.flatMap((line, li) =>
        Array.from(line).map((ch, i, a) => ({ch, x: c.cx + (i - (a.length - 1) / 2) * font * ADV, y: c.cy + (li - (lines.length - 1) / 2) * lineH}))
      );
      console.log(`[Bubble] "${it.text}" on ${it.center} bubble ${(rx * 2).toFixed(0)}x${(ry * 2).toFixed(0)}px`);
      return {c, rx, ry, letters};
    });
    // smooth curve from each bubble to the next: control point bows to the upper side
    const hops = items.slice(0, -1).map((a, k) => {
      const b = items[k + 1];
      const A = {x: a.c.cx, y: a.c.cy};
      const B = {x: b.c.cx, y: b.c.cy};
      const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      let nx = -(B.y - A.y) / len;
      let ny = (B.x - A.x) / len;
      if (ny > 0) [nx, ny] = [-nx, -ny];
      const C = {x: (A.x + B.x) / 2 + nx * len * 0.25, y: (A.y + B.y) / 2 + ny * len * 0.25};
      console.log(`[Bubble] hop ${k + 1}->${k + 2}: ${ITEMS[k].center} -> ${ITEMS[k + 1].center}, length ${len.toFixed(0)}px`);
      return {A, B, C};
    });
    const zc = ZOOM.cells.map((c) => cellRect(c, width, height, N));
    const origin = {x: zc.reduce((s, r) => s + r.cx, 0) / zc.length, y: zc.reduce((s, r) => s + r.cy, 0) / zc.length};
    return {cw, font, items, hops, origin};
  }, [width, height]);

  // key moments, logged once each
  ITEMS.forEach((it, k) => {
    const s = SCH[k];
    const marks: [string, number][] = [["words in", it.from], ["words gone", s.out]];
    if (k < ITEMS.length - 1) marks.push(["travel starts", s.out + 0.25 * s.W], ["travel ends", s.out + 0.75 * s.W]);
    marks.forEach(([name, tm]) => frame === Math.round(tm * fps) && console.log(`[Bubble] #${k + 1} "${it.text}" ${name} at ${tm.toFixed(3)}s (frame ${frame})`));
  });

  const zoom = interpolate(t, [ZOOM.from, ZOOM.to], [1, ZOOM.scale], {...clamp, easing: Easing.inOut(Easing.cubic)});
  const fadeStart = durationInFrames - FADE_OUT * fps;
  const endFade = interpolate(frame, [fadeStart, durationInFrames - 1], [1, 0], clamp);

  const blob = blobAt(t, ITEMS, SCH);
  const R = geo.cw * BALL;
  const lw = geo.cw * 0.06; // outline width

  // the whole bubble/ball/thread, drawn twice: wide in the outline color, then in the fill color
  const draw = (b: Blob, color: string, grow: number) => {
    if (b.kind === "cell") {
      const g = geo.items[b.k];
      const rx = (R + (g.rx - R) * b.o) * b.sc + grow * b.sc;
      const ry = (R + (g.ry - R) * b.o) * b.sc + grow * b.sc;
      return <ellipse cx={g.c.cx} cy={g.c.cy} rx={rx} ry={ry} fill={color} />;
    }
    const h = geo.hops[b.k];
    const head = Easing.out(Easing.cubic)(b.p); // head runs ahead
    const tail = Easing.in(Easing.cubic)(b.p); // tail lags, so the line stretches then gathers
    const th = 1 - 0.55 * Math.sin(Math.PI * b.p); // thinner while stretched
    const steps = Math.max(2, Math.ceil((head - tail) * 40));
    const pts = Array.from({length: steps + 1}, (_, i) => bez(h.A, h.C, h.B, tail + ((head - tail) * i) / steps));
    const hp = bez(h.A, h.C, h.B, head);
    const tp = bez(h.A, h.C, h.B, tail);
    return (
      <>
        <path d={`M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")}`} fill="none" stroke={color} strokeWidth={2 * R * th + 2 * grow} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={tp.x} cy={tp.y} r={R * th + grow} fill={color} />
        <circle cx={hp.x} cy={hp.y} r={R * (0.5 + 0.5 * th) + grow} fill={color} />
      </>
    );
  };

  return (
    <AbsoluteFill style={{background: "black"}}>
      <AbsoluteFill style={{opacity: endFade, transform: `scale(${zoom})`, transformOrigin: `${geo.origin.x}px ${geo.origin.y}px`}}>
        <OffthreadVideo src={staticFile(VIDEO3)} style={{width, height}} />
      </AbsoluteFill>

      <svg width={width} height={height} style={{position: "absolute", inset: 0}}>
        {blob && (
          <g style={{filter: `drop-shadow(0 0 ${lw * 2}px ${ACC})`}}>
            {draw(blob, ACC, lw)}
            {draw(blob, MAIN, 0)}
          </g>
        )}

        {ITEMS.map((it, k) => {
          const out = SCH[k].out;
          if (t < it.from || t >= out) return null;
          const span = Math.max(it.to - it.from, 0.05);
          const exit = interpolate(t, [out - EXIT, out], [1, 0], clamp);
          const {letters} = geo.items[k];
          return letters.map((l, i) => {
            const t0 = it.from + (letters.length > 1 ? i / (letters.length - 1) : 0) * 0.4 * span; // soft stagger
            const p = interpolate(t, [t0, t0 + 0.6 * span], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
            if (p <= 0) return null;
            return (
              <text
                key={`${k}-${i}`}
                x={l.x}
                y={l.y + (1 - p) * geo.font * 0.25}
                opacity={p * exit}
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily={fontFamily}
                fontWeight={800}
                fontSize={geo.font}
                fill={i % 3 === 2 ? ACC : TEXT}
              >
                {l.ch}
              </text>
            );
          });
        })}
      </svg>
    </AbsoluteFill>
  );
};