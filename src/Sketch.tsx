import {useEffect, useState} from "react";
import {
  AbsoluteFill,
  cancelRender,
  continueRender,
  delayRender,
  Easing,
  interpolate,
  random,
  staticFile,
  useCurrentFrame,
} from "remotion";

const W = 1080;
const H = 1920;
const PAPER = "#f3ecdc";
const PHOTO = staticFile("photo.png");

// Timeline (30fps): 0.5s blank paper -> outlines -> shading -> hold
const START = 15;
const SHADE = 285;
const END = 435;

type Pt = [number, number];
type Patch = {layer: 1 | 2; d: string; pts: Pt[]; cum: number[]; total: number; start: number; dur: number; width: number};

// A "patch" = one hand-hatched zigzag (back-and-forth pencil strokes) on a jittered grid cell.
// random() is seeded, so every frame/render process builds the exact same strokes.
const makePatches = (layer: 1 | 2, cols: number, rows: number, from: number, to: number, len: number, step: number, zigs: number, width: number): Patch[] => {
  const raw = Array.from({length: cols * rows}, (_, i) => {
    const r = (k: string) => random(`L${layer}-${i}-${k}`);
    const cx = (((i % cols) + 0.5 + (r("x") - 0.5) * 0.8) * W) / cols;
    const cy = ((Math.floor(i / cols) + 0.5 + (r("y") - 0.5) * 0.8) * H) / rows;
    const a = ((r("a") - 0.5) * 50 - 55) * (Math.PI / 180); // diagonal hatching
    const s: Pt = [Math.cos(a), Math.sin(a)];
    const n: Pt = [-s[1], s[0]];
    const pts: Pt[] = Array.from({length: zigs}, (_, k) => {
      const side = (k % 2 ? 0.5 : -0.5) * len * (0.8 + 0.4 * r(`l${k}`));
      const adv = (k - zigs / 2) * step;
      const jx = (r(`jx${k}`) - 0.5) * 16;
      const jy = (r(`jy${k}`) - 0.5) * 16;
      return [cx + s[0] * side + n[0] * adv + jx, cy + s[1] * side + n[1] * adv + jy];
    });
    const ring = Math.floor(Math.hypot(cx - W / 2, cy - H / 2) / 320);
    const ang = Math.atan2(cy - H / 2, cx - W / 2) * (ring % 2 ? 1 : -1);
    return {pts, ring, ang, w: 0.7 + 0.6 * r("w"), width: width * (0.85 + 0.3 * r("sw"))};
  }).sort((a, b) => a.ring - b.ring || a.ang - b.ang); // center-out, neighbours drawn one after another

  const sum = raw.reduce((t, p) => t + p.w, 0);
  let t = from;
  const patches = raw.map(({pts, w, width}) => {
    const cum = [0];
    pts.forEach((p, k) => k && cum.push(cum[k - 1] + Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1])));
    const slot = (w / sum) * (to - from);
    const patch: Patch = {
      layer, pts, cum, width,
      d: "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L"),
      total: cum[cum.length - 1],
      start: t,
      dur: slot * 0.85, // remaining 15% = pencil lifts and travels to the next patch
    };
    t += slot;
    return patch;
  });
  console.log(`[Sketch] layer ${layer}: ${patches.length} patches, frames ${from}-${to}`);
  return patches;
};

const PATCHES = [
  ...makePatches(1, 6, 10, START, SHADE, 260, 24, 16, 38), // outlines
  ...makePatches(2, 4, 6, SHADE, END, 420, 52, 12, 72), // soft shading
];

const progress = (p: Patch, frame: number) =>
  interpolate(frame, [p.start, p.start + p.dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });

const pointAt = (p: Patch, t: number): Pt => {
  const target = t * p.total;
  let k = 1;
  while (k < p.pts.length - 1 && p.cum[k] < target) k++;
  const f = (target - p.cum[k - 1]) / (p.cum[k] - p.cum[k - 1] || 1);
  return [p.pts[k - 1][0] + (p.pts[k][0] - p.pts[k - 1][0]) * f, p.pts[k - 1][1] + (p.pts[k][1] - p.pts[k - 1][1]) * f];
};

// Where the pencil tip is: on the active stroke, or travelling between two strokes
const pencilAt = (frame: number): Pt | null => {
  let i = -1;
  PATCHES.forEach((p, k) => {
    if (p.start <= frame) i = k;
  });
  if (i < 0) return null;
  const p = PATCHES[i];
  const end = p.start + p.dur;
  if (frame <= end) return pointAt(p, progress(p, frame));
  const next = PATCHES[i + 1];
  if (!next) return null;
  const a = pointAt(p, 1);
  const b = pointAt(next, 0);
  const f = (frame - end) / (next.start - end);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
};

const Pencil = ({x, y, frame}: {x: number; y: number; frame: number}) => (
  <g transform={`translate(${x} ${y}) rotate(${24 + 5 * Math.sin(frame * 0.9)}) scale(0.8)`}>
    <rect x={-18} y={-440} width={36} height={30} rx={8} fill="#e8737f" />
    <rect x={-18} y={-410} width={36} height={30} fill="#b5b9bf" />
    <rect x={-18} y={-380} width={36} height={320} fill="#f2b632" />
    <rect x={-4} y={-380} width={8} height={320} fill="#d99a14" />
    <polygon points="0,0 -18,-60 18,-60" fill="#e9c9a0" />
    <polygon points="0,0 -6,-20 6,-20" fill="#333" />
  </g>
);

const Strokes = ({layer, frame}: {layer: 1 | 2; frame: number}) => (
  <g filter="url(#rough)" fill="none" stroke="white" strokeLinecap="round" strokeLinejoin="round">
    {PATCHES.filter((p) => p.layer === layer).map((p, i) => {
      const t = progress(p, frame);
      return t > 0 ? <path key={i} d={p.d} strokeWidth={p.width} pathLength={1} strokeDasharray={`${t} 2`} /> : null;
    })}
  </g>
);

const FULL = {filterUnits: "userSpaceOnUse", x: 0, y: 0, width: W, height: H, colorInterpolationFilters: "sRGB"} as const;
const invert = (
  <>
    <feFuncR type="linear" slope="-1" intercept="1" />
    <feFuncG type="linear" slope="-1" intercept="1" />
    <feFuncB type="linear" slope="-1" intercept="1" />
  </>
);

export const PencilSketch = () => {
  const frame = useCurrentFrame();
  const [handle] = useState(() => delayRender("Loading public/photo.png"));

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      console.log(`[PencilSketch] photo loaded ${img.naturalWidth}x${img.naturalHeight}`);
      continueRender(handle);
    };
    img.onerror = () => cancelRender(new Error("Could not load public/photo.png - put your photo there"));
    img.src = PHOTO;
  }, [handle]);

  if (frame === START) console.log("[PencilSketch] stage 1: outlines");
  if (frame === SHADE) console.log("[PencilSketch] stage 2: shading");
  if (frame === END) console.log("[PencilSketch] done, holding final drawing");

  const seed = Math.floor(frame / 2) % 8; // line "boil": new hand jitter every 2 frames
  const pencil = pencilAt(frame);

  return (
    <AbsoluteFill style={{background: PAPER}}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          {/* rough, shaky edges for the reveal strokes */}
          <filter id="rough" {...FULL}>
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="18" xChannelSelector="R" yChannelSelector="G" />
          </filter>

          {/* pencil outline: grayscale -> invert -> blur -> color-dodge (classic sketch recipe) + hand wobble */}
          <filter id="sketch" {...FULL}>
            <feColorMatrix type="saturate" values="0" result="gray" />
            <feComponentTransfer in="gray" result="inv">{invert}</feComponentTransfer>
            <feGaussianBlur in="inv" stdDeviation="6" result="blur" />
            <feBlend in="blur" in2="gray" mode="color-dodge" result="dodge" />
            <feComponentTransfer in="dodge" result="ink">
              <feFuncR type="gamma" exponent="2.5" />
              <feFuncG type="gamma" exponent="2.5" />
              <feFuncB type="gamma" exponent="2.5" />
            </feComponentTransfer>
            <feTurbulence type="turbulence" baseFrequency="0.012" numOctaves="2" seed={seed} result="warp" />
            <feDisplacementMap in="ink" in2="warp" scale="10" xChannelSelector="R" yChannelSelector="G" result="wobble" />
            <feFlood floodColor={PAPER} result="paper" />
            <feBlend in="wobble" in2="paper" mode="multiply" result="onPaper" />
            <feComposite in="onPaper" in2="SourceAlpha" operator="in" />
          </filter>

          {/* graphite shading: contrasty grayscale x grainy noise */}
          <filter id="tone" {...FULL}>
            <feColorMatrix type="saturate" values="0" result="g" />
            <feComponentTransfer in="g" result="c">
              <feFuncR type="linear" slope="1.5" intercept="-0.25" />
              <feFuncG type="linear" slope="1.5" intercept="-0.25" />
              <feFuncB type="linear" slope="1.5" intercept="-0.25" />
            </feComponentTransfer>
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="3" result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0.3 0 0 0 0.7  0.3 0 0 0 0.7  0.3 0 0 0 0.7  0 0 0 0 1" result="grain" />
            <feBlend in="c" in2="grain" mode="multiply" result="shaded" />
            <feComposite in="shaded" in2="SourceAlpha" operator="in" />
          </filter>

          <mask id="m1" maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
            <Strokes layer={1} frame={frame} />
          </mask>
          <mask id="m2" maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
            <Strokes layer={2} frame={frame} />
          </mask>
        </defs>

        <image href={PHOTO} width={W} height={H} preserveAspectRatio="xMidYMid meet" filter="url(#sketch)" mask="url(#m1)" />
        <image href={PHOTO} width={W} height={H} preserveAspectRatio="xMidYMid meet" filter="url(#tone)" mask="url(#m2)" opacity={0.6} style={{mixBlendMode: "multiply"}} />
        {pencil && <Pencil x={pencil[0]} y={pencil[1]} frame={frame} />}
      </svg>
    </AbsoluteFill>
  );
};