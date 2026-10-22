import {useMemo} from "react";
import {AbsoluteFill, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig, Solid} from "remotion";
import {loadFont} from "@remotion/google-fonts/Poppins";
import {cellRect} from "./gridCell";
import {VIDEO} from "./VideoCurve";

const {fontFamily} = loadFont("normal", {weights: ["800"]});

// ---- Look ----
const N = 15; // 15x15 grid
const DARK = "#130027"; // main color (used most)
const PINK = "#D350EB"; // accent color
const POP = 0.08; // seconds a letter takes to pop in
const EXIT = 0.08; // seconds a word takes to vanish
const ADV = 0.62; // letter width as a fraction of font size

type Fx = "pop" | "wobble" | "drop" | "push";
type Item = {
  text: string;
  fx: Fx;
  from: number; // seconds: first letter appears
  to: number; // seconds: last letter appears
  out?: number; // seconds: word disappears (empty = stays)
  line?: [string, string]; // letters run diagonally from first cell to last cell
  center?: string[]; // word centered on the middle of these cells
  size?: number; // font size in cells (for centered words)
  emoji?: boolean;
};

// ---- Timeline (edit times / cells here) ----
const STEP = (0.639 - POP) / 16; // 17 title letters, all visible by 0.639s
const TIMELINE: Item[] = [
  {text: "Danish", fx: "pop", line: ["B3", "G2"], from: 0, to: 5 * STEP},
  {text: "girl", fx: "pop", line: ["D7", "J5"], from: 6 * STEP, to: 9 * STEP},
  {text: "dancing", fx: "pop", line: ["E9", "H7"], from: 10 * STEP, to: 16 * STEP},
  {text: "💥", fx: "pop", emoji: true, center: ["L8", "M8", "L9", "M9", "L10"], size: 2.6, from: 1.07, to: 1.07, out: 1.07 + 0.135},
  {text: "roll", fx: "wobble", center: ["I4", "I5"], size: 1.7, from: 1.28, to: 1.68},
  {text: "hip", fx: "pop", center: ["K8"], size: 2, from: 2.489, to: 2.549, out: 3.239},
  {text: "hip", fx: "pop", center: ["E8"], size: 2, from: 2.849, to: 2.909, out: 3.239},
  {text: "drop", fx: "drop", center: ["H6"], size: 2, from: 3.294, to: 3.793, out: 4.55}, // cell not specified: H6
  {text: "push", fx: "push", center: ["H10"], size: 2, from: 3.93, to: 4.248, out: 4.55}, // cell not specified: H10
  {text: "look", fx: "pop", center: ["D9"], size: 2, from: 5.512, to: 6.04},
];

// Pixel position of every letter of an item
const layout = (it: Item, w: number, h: number) => {
  const chars = Array.from(it.text);
  const n = chars.length;
  if (it.line) {
    const a = cellRect(it.line[0], w, h, N);
    const b = cellRect(it.line[1], w, h, N);
    const spacing = Math.hypot(b.cx - a.cx, b.cy - a.cy) / Math.max(n - 1, 1);
    const angle = (Math.atan2(b.cy - a.cy, b.cx - a.cx) * 180) / Math.PI;
    const letters = chars.map((ch, i) => {
      const t = n > 1 ? i / (n - 1) : 0;
      return {ch, x: a.cx + (b.cx - a.cx) * t, y: a.cy + (b.cy - a.cy) * t};
    });
    console.log(`[DanceEdit] "${it.text}" ${it.line[0]}->${it.line[1]} font=${(spacing / ADV).toFixed(0)}px angle=${angle.toFixed(0)}deg`);
    return {letters, font: spacing / ADV, angle};
  }
  const rects = it.center!.map((c) => cellRect(c, w, h, N));
  const cx = rects.reduce((s, r) => s + r.cx, 0) / rects.length;
  const cy = rects.reduce((s, r) => s + r.cy, 0) / rects.length;
  const font = (it.size ?? 2) * (w / N);
  const letters = chars.map((ch, i) => ({ch, x: cx + (i - (n - 1) / 2) * font * ADV, y: cy}));
  console.log(`[DanceEdit] "${it.text}" centered on ${it.center!.join("+")} font=${font.toFixed(0)}px`);
  return {letters, font, angle: 0};
};

export const DanceEdit = () => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const t = frame / fps;
  const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

  const laid = useMemo(() => TIMELINE.map((it) => layout(it, width, height)), [width, height]);

  return (
    <>
      <AbsoluteFill style={{background: "black"}}>
        <OffthreadVideo src={staticFile(VIDEO)} style={{width, height}} />
        <svg width={width} height={height} style={{position: "absolute", inset: 0}}>
          {TIMELINE.map((it, k) => {
            const {letters, font, angle} = laid[k];
            if (frame === Math.round(it.from * fps)) console.log(`[DanceEdit] "${it.text}" starts at ${it.from}s (frame ${frame})`);
            if (it.out !== undefined && frame === Math.round(it.out * fps)) console.log(`[DanceEdit] "${it.text}" gone at ${it.out}s (frame ${frame})`);
      
            return letters.map((l, i) => {
              const n = letters.length;
              const t0 = it.from + (n > 1 ? i / (n - 1) : 0) * (it.to - it.from);
              if (t < t0 || (it.out !== undefined && t >= it.out)) return null;
      
              const s = spring({frame: (t - t0) * fps, fps, config: {damping: it.fx === "drop" ? 7 : 10, stiffness: 180}});
              const exit = it.out !== undefined ? interpolate(t, [it.out - EXIT, it.out], [1, 0], clamp) : 1;
      
              let scale = 1;
              let dx = 0;
              let dy = 0;
              let rot = 0;
              if (it.fx === "pop") scale = s;
              if (it.fx === "drop") dy = -(1 - s) * font * 3; // falls from above and bounces
              if (it.fx === "push") dx = -(1 - s) * font * 2.5; // shoved in from the left
              if (it.fx === "wobble") {
                scale = s;
                rot = Math.sin(t * 9 + i * 1.3) * 9;
                dy = Math.sin(t * 7 + i * 2.1) * font * 0.12;
                dx = Math.sin(t * 5 + i * 0.7) * font * 0.04;
              }
      
              const swap = i % 3 === 2; // dark most of the time, pink accents between
              return (
                <g key={`${k}-${i}`} opacity={Math.min(1, s * 2) * exit} transform={`translate(${l.x} ${l.y}) rotate(${angle + rot}) translate(${dx} ${dy}) scale(${scale * (0.6 + 0.4 * exit)})`}>
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontFamily={fontFamily}
                    fontWeight={800}
                    fontSize={font}
                    fill={swap ? PINK : DARK}
                    stroke={it.emoji ? "none" : swap ? DARK : PINK}
                    strokeWidth={font * 0.09}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                    style={{filter: it.emoji ? undefined : `drop-shadow(0 ${font * 0.05}px ${font * 0.1}px ${swap ? DARK : PINK})`}}
                  >
                    {l.ch}
                  </text>
                </g>
              );
            });
          })}
        </svg>
      </AbsoluteFill>
      <Solid
        width={828}
        height={1202}
        color="gray"
        style={{position: "absolute"}}
        premountFor={30}
      />
    </>
  );
};