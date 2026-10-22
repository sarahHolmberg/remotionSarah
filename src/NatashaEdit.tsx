import {useMemo} from "react";
import {AbsoluteFill, Easing, interpolate, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {loadFont} from "@remotion/google-fonts/Poppins"; // same font as before
import {cellRect} from "./gridCell";

const {fontFamily} = loadFont("normal", {weights: ["800"]});

export const VIDEO3 = "natasjasanfeld.mp4"; // file in /public

// ---- Look (no colors were given for this video: the first palette is used, change here) ----
const N = 15; // 15x15 grid
const MAIN = "#010001"; // main text color
const ACC = "#655551"; // outline, glow, accent letters
const ADV = 0.62; // letter width as a fraction of font size
const SIZE = 1.15; // text size in cells
const EXIT = 0.05; // seconds a word takes to fade out
const FADE_OUT = 1; // seconds: the video fades to black at the very end

// ---- Zoom: 5% toward the middle of G7..J9, then held ----
const ZOOM = {from: 3.55, to: 3.87, scale: 1.05, cells: ["G7", "J7", "G9", "J9"]};

// ---- Big arrow: grows from the name toward this cell during the name's window ----
const ARROW_TO = "F8";

type Item = {
  text: string; // multi-word text stacks one word per line
  from: number; // fade-in starts
  to: number; // fade-in finished
  out?: number; // empty = disappears 0.05s before the next item (last one stays)
  center: string; // centered on this cell
  arrowRight?: boolean; // small arrow pointing right, drawn beside the text
};

// The first item is the name with the big arrow
const RAW: Item[] = [
  {text: "Natasja Sandfeld", from: 0.893, to: 2.103, center: "J7"},
  {text: "swipe", from: 3.23, to: 3.433, center: "J8", arrowRight: true},
  {text: "kick leg up", from: 3.551, to: 3.887, center: "K11"},
  {text: "turn head", from: 4.085, to: 4.433, center: "E6"},
  {text: "hands move up", from: 4.821, to: 5.058, center: "C8"},
  {text: "half turn", from: 5.785, to: 6.22, center: "I6"},
  {text: "move leg and turn", from: 6.546, to: 6.989, center: "L12"},
  {text: "right heel out", from: 7.207, to: 7.407, center: "D10"},
  {text: "hands go up", from: 8.133, to: 8.646, center: "I9"},
  {text: "cross hands", from: 8.822, to: 9.185, center: "F6"},
  {text: "look up", from: 9.251, to: 9.451, center: "F5"},
  {text: "jump to the right", from: 9.496, to: 10.359, center: "E8"},
  {text: "right leg back", from: 10.589, to: 11.149, center: "H12"},
  {text: "right leg forward", from: 11.965, to: 12.389, center: "F13"},
  {text: "heel heel kick", from: 12.784, to: 13.067, center: "G12"},
  {text: "cross leg", from: 13.384, to: 13.584, center: "D13"},
  {text: "leg around", from: 13.744, to: 14.224, center: "C13"},
  {text: "leg back", from: 14.584, to: 14.864, center: "B13"},
  {text: "jump back", from: 15.224, to: 15.504, center: "C12"},
  {text: "look right", from: 16.464, to: 16.704, center: "F7"},
  {text: "swing arms", from: 17.424, to: 17.704, center: "N6"},
  {text: "raised leg", from: 18.464, to: 18.704, center: "D7", out: 19.2}, // no longer stays to the end
];

// Default exit: 0.05s before the next text (but never before this text has finished fading in)
const ITEMS: Item[] = RAW.map((it, i) => {
  const next = RAW[i + 1];
  return {...it, out: it.out ?? (next ? Math.max(next.from - 0.05, it.to + EXIT) : undefined)};
});

// Pixel position of every letter (words become stacked lines)
const layout = (it: Item, w: number, h: number) => {
  const font = SIZE * (w / N);
  const c = cellRect(it.center, w, h, N);
  const lines = it.text.split(" ");
  const lineH = font * 1.15;

  const letters: {ch: string; x: number; y: number}[] = [];
  lines.forEach((line, li) => {
    const chars = Array.from(line);
    const y = c.cy + (li - (lines.length - 1) / 2) * lineH;
    chars.forEach((ch, i) => letters.push({ch, x: c.cx + (i - (chars.length - 1) / 2) * font * ADV, y}));
  });

  // exact cell positions; only nudged if the text would be cut off by the frame edge
  const half = (font * ADV) / 2;
  const minX = Math.min(...letters.map((l) => l.x)) - half;
  const maxX = Math.max(...letters.map((l) => l.x)) + half;
  const shift = minX < 0 ? -minX : maxX > w ? w - maxX : 0;
  letters.forEach((l) => (l.x += shift));

  console.log(`[Natasha] "${it.text}" on ${it.center} font=${font.toFixed(0)}px lines=${lines.length} edge-shift=${shift.toFixed(0)}px`);
  return {letters, font, left: minX + shift, right: maxX + shift, cy: c.cy};
};

export const NatashaEdit = () => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const t = frame / fps;
  const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

  const geo = useMemo(() => {
    const cw = width / N;
    const laid = ITEMS.map((it) => layout(it, width, height));
    const zc = ZOOM.cells.map((c) => cellRect(c, width, height, N));
    const origin = {x: zc.reduce((s, r) => s + r.cx, 0) / zc.length, y: zc.reduce((s, r) => s + r.cy, 0) / zc.length};
    // big arrow: tail just left of the name, tip in the right part of the target cell
    const f8 = cellRect(ARROW_TO, width, height, N);
    const tail = {x: laid[0].left - cw * 0.2, y: laid[0].cy};
    const tip = {x: f8.x + f8.w * 0.8, y: f8.cy};
    const ctrl = {x: (tip.x + tail.x) / 2, y: Math.min(tip.y, tail.y) - cw * 0.5}; // slight upward bow
    const angle = (Math.atan2(tip.y - ctrl.y, tip.x - ctrl.x) * 180) / Math.PI;
    console.log(`[Natasha] zoom origin ${origin.x.toFixed(0)},${origin.y.toFixed(0)} | arrow tail ${tail.x.toFixed(0)},${tail.y.toFixed(0)} -> ${ARROW_TO} ${tip.x.toFixed(0)},${tip.y.toFixed(0)}`);
    return {cw, laid, origin, tail, tip, ctrl, angle};
  }, [width, height]);

  if (frame === Math.round(ZOOM.from * fps)) console.log(`[Natasha] zoom starts ${ZOOM.from}s -> ${ZOOM.scale}x`);
  if (frame === Math.round(ZOOM.to * fps)) console.log(`[Natasha] zoom ends ${ZOOM.to}s (holds)`);
  const zoom = interpolate(t, [ZOOM.from, ZOOM.to], [1, ZOOM.scale], {...clamp, easing: Easing.inOut(Easing.cubic)});

  const fadeStart = durationInFrames - FADE_OUT * fps;
  if (frame === Math.round(fadeStart)) console.log(`[Natasha] fade to black starts (frame ${frame} of ${durationInFrames})`);
  const endFade = interpolate(frame, [fadeStart, durationInFrames - 1], [1, 0], clamp); // video opacity 1 -> 0 over black

  // Big arrow (same window as the name)
  const first = ITEMS[0];
  const draw = interpolate(t, [first.from, first.to], [0, 1], {...clamp, easing: Easing.inOut(Easing.cubic)});
  const headOn = interpolate(draw, [0.85, 1], [0, 1], clamp);
  const arrowOut = first.out !== undefined ? interpolate(t, [first.out - EXIT, first.out], [1, 0], clamp) : 1;
  const lw = geo.cw * 0.09;
  const hs = geo.cw * 0.4;
  const arrowPath = `M ${geo.tail.x} ${geo.tail.y} Q ${geo.ctrl.x} ${geo.ctrl.y} ${geo.tip.x} ${geo.tip.y}`;

  return (
    <AbsoluteFill style={{background: "black"}}>
      <AbsoluteFill style={{opacity: endFade, transform: `scale(${zoom})`, transformOrigin: `${geo.origin.x}px ${geo.origin.y}px`}}>
        <OffthreadVideo src={staticFile(VIDEO3)} style={{width, height}} />
      </AbsoluteFill>

      <svg width={width} height={height} style={{position: "absolute", inset: 0}}>
        {draw > 0.001 && arrowOut > 0 && (
          <g opacity={arrowOut} style={{filter: `drop-shadow(0 0 ${lw}px ${ACC})`}}>
            <path d={arrowPath} fill="none" stroke={ACC} strokeWidth={lw * 2.2} strokeLinecap="round" pathLength={1} strokeDasharray={`${draw} 2`} />
            <path d={arrowPath} fill="none" stroke={MAIN} strokeWidth={lw} strokeLinecap="round" pathLength={1} strokeDasharray={`${draw} 2`} />
            <polygon
              points={`0,0 ${-hs},${-hs * 0.6} ${-hs},${hs * 0.6}`}
              fill={MAIN}
              stroke={ACC}
              strokeWidth={lw * 0.6}
              strokeLinejoin="round"
              opacity={headOn}
              transform={`translate(${geo.tip.x} ${geo.tip.y}) rotate(${geo.angle}) scale(${headOn})`}
            />
          </g>
        )}

        {ITEMS.map((it, k) => {
          const {letters, font, right, cy} = geo.laid[k];
          if (frame === Math.round(it.from * fps)) console.log(`[Natasha] "${it.text}" fades in ${it.from}s -> ${it.to}s`);
          if (it.out !== undefined && frame === Math.round(it.out * fps)) console.log(`[Natasha] "${it.text}" gone at ${it.out.toFixed(3)}s`);
          if (it.out !== undefined && t >= it.out) return null;

          const span = Math.max(it.to - it.from, 0.05);
          const exit = it.out !== undefined ? interpolate(t, [it.out - EXIT, it.out], [1, 0], clamp) : 1;
          const whole = interpolate(t, [it.from, it.to], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)}); // for the small arrow

          return (
            <g key={k}>
              {letters.map((l, i) => {
                const n = letters.length;
                const t0 = it.from + (n > 1 ? i / (n - 1) : 0) * 0.4 * span; // soft stagger
                const p = interpolate(t, [t0, t0 + 0.6 * span], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)}); // info-video fade + small rise
                if (p <= 0) return null;
                const swap = i % 3 === 2; // main color most of the time, accent between
                return (
                  <g key={i} opacity={p * exit} transform={`translate(${l.x} ${l.y + (1 - p) * font * 0.25})`}>
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontFamily={fontFamily}
                      fontWeight={800}
                      fontSize={font}
                      fill={swap ? ACC : MAIN}
                      stroke={swap ? MAIN : ACC}
                      strokeWidth={font * 0.13}
                      strokeLinejoin="round"
                      paintOrder="stroke"
                      style={{filter: `drop-shadow(0 0 ${font * 0.14}px ${ACC}) drop-shadow(0 ${font * 0.05}px ${font * 0.08}px ${MAIN})`}}
                    >
                      {l.ch}
                    </text>
                  </g>
                );
              })}

              {it.arrowRight && whole > 0 && (
                <g opacity={exit} style={{filter: `drop-shadow(0 0 ${geo.cw * 0.05}px ${ACC})`}}>
                  {(() => {
                    const x0 = right + geo.cw * 0.2;
                    const len = geo.cw * 0.8 * whole; // grows to the right
                    const w = geo.cw * 0.06;
                    return (
                      <>
                        <path d={`M ${x0} ${cy} L ${x0 + len} ${cy}`} stroke={ACC} strokeWidth={w * 2.2} strokeLinecap="round" />
                        <path d={`M ${x0} ${cy} L ${x0 + len} ${cy}`} stroke={MAIN} strokeWidth={w} strokeLinecap="round" />
                        <polygon points="0,0 -9,-6 -9,6" transform={`translate(${x0 + len} ${cy}) scale(${(geo.cw * 0.3) / 9 * whole})`} fill={MAIN} stroke={ACC} strokeWidth={2} strokeLinejoin="round" />
                      </>
                    );
                  })()}
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};