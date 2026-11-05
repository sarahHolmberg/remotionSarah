// src/Bubbles3D.tsx
// NEW FILE: the "Real 3D" bubble style (JSON bubble3d.engine = "three"), drawn with Three.js through @remotion/three.
// Each bubble is our comic bubble made solid: the oval and its tails as one outline (and the name bubble's picture circle)
// pushed out into a thick body with a rounded, bevelled edge all the way round, lit softly from the top right, with the black outline
// as a slightly bigger black copy right behind it. The disc is turned around its vertical axis (left side forward).
// The camera looks straight at the video with no perspective (orthographic, 1 unit = 1 pixel), so a point on a bubble's
// front face lands at cx + dx * cos(turn): ComicEdit uses that to make the tails end exactly on their cell and to put the
// words (drawn in SVG on top) exactly on the bubble.

import {useEffect, useMemo} from "react";
import {ThreeCanvas} from "@remotion/three";
import {BackSide, ExtrudeGeometry, Shape, type BufferGeometry} from "three";

export type P2 = {x: number; y: number};
export type Tail3D = {phi: number; c1: P2; tip: P2; c2: P2}; // in the bubble's own plane: pixels from its center, y down; phi = the angle on the oval it leaves from
export type Bubble3D = {key: string; cx: number; cy: number; rx: number; ry: number; pic: {x: number; y: number; r: number} | null; tails: Tail3D[]; slant: number; depth: number};

// ---- LOOK (change here) ----
const BEVEL_SIZE = 0.07; // how far the rounded edge reaches in from the rim, as a share of the bubble's size
const BEVEL_THICK = 0.3; // how deep the rounded edge is, as a share of the thickness
const ROUGHNESS = 0.38; // 0 = shiny, 1 = matt
const AMBIENT = 0.6; // light from everywhere: the turned-away edge gets only this
const SUN = 0.45; // light from the top right front
const OUTLINE_BEHIND = 0.6; // pixels the black copy sits behind the bubble
const TAIL_HALF_WIDTH = 0.35; // radians: the tail leaves the oval between phi - this and phi + this

// a unit disc (radius 1, thickness 1) with a rounded edge; scaled to each bubble's size
const makeDisc = () =>
  new ExtrudeGeometry(new Shape().absellipse(0, 0, 1 - BEVEL_SIZE, 1 - BEVEL_SIZE, 0, Math.PI * 2, false, 0), {
    depth: 1,
    bevelEnabled: true,
    bevelSize: BEVEL_SIZE,
    bevelThickness: BEVEL_THICK,
    bevelSegments: 5,
    curveSegments: 72,
  });

// the black outline copy shows only its far-facing surfaces ("inverted hull"): around the edge it peeks out as a rim,
// everywhere else the bubble is in front of it, and its own near side never covers the bubble's lit side
const Material = ({color, flat}: {color: string; flat: boolean}) => (flat ? <meshBasicMaterial color={color} side={BackSide} /> : <meshStandardMaterial color={color} roughness={ROUGHNESS} metalness={0} />);

// a disc whose front face is at z (the bevel included)
const Disc = ({geo, x, y, rx, ry, depth, z, color, flat}: {geo: BufferGeometry; x: number; y: number; rx: number; ry: number; depth: number; z: number; color: string; flat: boolean}) => (
  <mesh geometry={geo} position={[x, -y, z - (1 + BEVEL_THICK) * depth]} scale={[rx, ry, depth]}>
    <Material color={color} flat={flat} />
  </mesh>
);

// the oval and its tails as ONE outline, pushed out with a rounded edge all the way round (so the tail has no seam).
// grow > 0 makes the black copy: the oval a little bigger, the tail points pushed outward.
const outline = (rx: number, ry: number, tails: Tail3D[], grow: number) => {
  const s = new Shape();
  const at = (a: number) => ({x: rx * Math.cos(a), y: ry * Math.sin(a)});
  const sorted = [...tails].map((t) => ({...t, phi: ((t.phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)})).sort((a, b) => a.phi - b.phi);
  const put = (p: P2, first = false) => (first ? s.moveTo(p.x, -p.y) : s.lineTo(p.x, -p.y)); // y up in 3D
  if (!sorted.length) {
    for (let i = 0; i <= 96; i++) put(at((i / 96) * 2 * Math.PI), i === 0);
    return s;
  }
  const push = (p: P2) => {
    const d = Math.hypot(p.x, p.y) || 1;
    return grow ? {x: p.x + (p.x / d) * grow, y: p.y + (p.y / d) * grow} : p;
  };
  sorted.forEach((t, i) => {
    // the oval from the previous tail's far corner to this tail's near corner, then out along the tail and back
    const from = i === 0 ? sorted[sorted.length - 1].phi + TAIL_HALF_WIDTH - 2 * Math.PI : sorted[i - 1].phi + TAIL_HALF_WIDTH;
    const to = t.phi - TAIL_HALF_WIDTH;
    const steps = Math.max(2, Math.ceil(((to - from) / (2 * Math.PI)) * 96));
    for (let k = 0; k <= steps; k++) put(at(from + ((to - from) * k) / steps), i === 0 && k === 0);
    const [c1, tip, c2, b2] = [t.c1, t.tip, t.c2, at(t.phi + TAIL_HALF_WIDTH)].map(push);
    s.quadraticCurveTo(c1.x, -c1.y, tip.x, -tip.y);
    s.quadraticCurveTo(c2.x, -c2.y, b2.x, -b2.y);
  });
  return s;
};

const Body = ({b, grow, depth, z, color, flat}: {b: Bubble3D; grow: number; depth: number; z: number; color: string; flat: boolean}) => {
  const bevel = Math.min(b.rx, b.ry) * BEVEL_SIZE;
  const sig = `${b.rx.toFixed(1)} ${b.ry.toFixed(1)} ${depth.toFixed(1)} ${grow} ${b.tails.map((t) => [t.phi, t.c1.x, t.c1.y, t.tip.x, t.tip.y, t.c2.x, t.c2.y].map((v) => v.toFixed(1)).join(",")).join(" ")}`;
  const geo = useMemo(() => {
    // the outline is drawn the bevel's width smaller: the rounded edge brings it back out to the full size
    const shape = outline(Math.max(1, b.rx + grow - bevel), Math.max(1, b.ry + grow - bevel), b.tails, grow);
    return new ExtrudeGeometry(shape, {depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: depth * BEVEL_THICK, bevelSegments: 5, curveSegments: 14});
  }, [sig]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} position={[0, 0, z - (1 + BEVEL_THICK) * depth]}>
      <Material color={color} flat={flat} />
    </mesh>
  );
};

export const Bubbles3DLayer = ({bubbles, width, height, fill, ink, outline, opacity}: {bubbles: Bubble3D[]; width: number; height: number; fill: string; ink: string; outline: number; opacity: number}) => {
  const disc = useMemo(makeDisc, []);
  useEffect(() => () => disc.dispose(), [disc]);
  return (
    <ThreeCanvas width={width} height={height} orthographic flat camera={{position: [0, 0, 3000], near: 1, far: 10000, zoom: 1}} gl={{antialias: true, alpha: true}} style={{position: "absolute", inset: 0, opacity}}>
      <ambientLight intensity={Math.PI * AMBIENT} />
      <directionalLight position={[400, 600, 1000]} intensity={Math.PI * SUN} />
      {bubbles.map((b) => {
        const depth = Math.max(b.depth, 0.01);
        return (
          <group key={b.key} position={[b.cx - width / 2, height / 2 - b.cy, 0]} rotation={[0, b.slant, 0]}>
            {/* the black outline: everything a little bigger, just behind */}
            <Body b={b} grow={outline} depth={depth} z={-OUTLINE_BEHIND} color={ink} flat />
            {b.pic && <Disc geo={disc} x={b.pic.x} y={b.pic.y} rx={b.pic.r + outline} ry={b.pic.r + outline} depth={depth} z={-OUTLINE_BEHIND} color={ink} flat />}
            {/* the bubble itself: the oval with its tails in one piece, and the name bubble's picture circle */}
            <Body b={b} grow={0} depth={depth} z={0} color={fill} flat={false} />
            {b.pic && <Disc geo={disc} x={b.pic.x} y={b.pic.y} rx={b.pic.r} ry={b.pic.r} depth={depth} z={0} color={fill} flat={false} />}
          </group>
        );
      })}
    </ThreeCanvas>
  );
};
