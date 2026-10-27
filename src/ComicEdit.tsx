// src/ComicEdit.tsx
// NOT NEW: existing file, changed (the impact burst behind chosen bubbles, JSON "impact"; the outro and name zoom sliders moved to the editor tab)

import {useMemo} from "react";
import {AbsoluteFill, Audio, Easing, Img, interpolate, OffthreadVideo, random, Sequence, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {loadFont} from "@remotion/google-fonts/ComicNeue"; // the only font the JSON can name for now
import {cellRect} from "./gridCell";
import {blobsAt, chainGroups, chainSchedule, type ChainBlob} from "./bubbleTimeline";
import type {Caption, Spec} from "./spec";

const {fontFamily} = loadFont("normal", {weights: ["700"]});
const ADV = 0.66; // average capital-letter width as a fraction of font size (only sizes the bubble)

// ---- BUBBLE SIZE (change here) ----
// The size of the TEXT in every bubble is in the JSON: style.font.sizeCells. The bubble grows with its text.
// These four numbers decide how much room the bubble gives the text:
const BUBBLE_W_SCALE = 1.3; // wider bubble around the same text (1 = tight)
const BUBBLE_W_PAD = 0.7; // extra half-width, in text sizes
const BUBBLE_H_SCALE = 1.3; // taller bubble around the same text (1 = tight)
const BUBBLE_H_PAD = 0.55; // extra half-height, in text sizes

// ---- POP SOUND (change here) ----
const POP_FILE = "universfield-bubble-pop-05-323639.mp3"; // file in /public
const POP_HIT = 0.26; // seconds into the file where the actual "pop" sits (it starts with a short swell, the pop is at about 0.26s)
const POP_VOLUME = 1; // 0 to 1

// ---- IMPACT BURST (change here; the size is a slider in the editor tab, JSON "impact") ----
const IMPACT_FILE = "impact-burst.png"; // file in /public: white burst on a see-through background (made from burst.png)

// ---- OUTRO: the end bubble (change here; how long before the end it starts is the slider in the editor tab, JSON "outro") ----
// As a share of the outro time: the ball pops up in the middle, grows until it fills the screen while three dots bounce,
// then the dots turn into the text, which pops in with the pop sound and stays until the end.
const OUTRO_POP = 0.15; // ball pops up (0 to this)
const OUTRO_FILL = 0.55; // ... grows until it covers the whole screen (OUTRO_POP to this)
const OUTRO_TEXT = 0.6; // the dots are gone and the text pops in
const OUTRO_TEXT_POP = 0.15; // time the text takes to pop in
const OUTRO_START_SIZE = 0.28; // bubble half-width after the pop, as a fraction of the video width

// ---- NAME EFFECT: blur, then zoom, hold, reset (change here) ----
const NAME_BLUR = 0.006; // how blurry the video gets behind the name, as a fraction of the video width (1080px wide = about 6.5px)
const NAME_BLUR_SECONDS = 0.25; // the video blurs first, over this time; the zoom starts right after
const NAME_RESET_MARGIN = 0.05; // seconds: blur and zoom are back to normal this long before the next text starts

// ---- NAME BUBBLE (the caption with this id gets a picture bubble on top and big words below) ----
const NAME_BUBBLE_ID = 1;
const NAME_TEXT_SCALE = 1.6; // its words are this many times bigger than normal text; bigger than the bubble = sticks out
const NAME_TEXT_TILT = -4; // degrees, 0 = straight
const NAME_PIC_CELLS = 1.1; // picture bubble radius, in grid cells
const NAME_PIC_LEFT = 0.35; // picture bubble sits this far left of the center (fraction of the words bubble half-width, negative = right)
const NAME_PIC_UP = 0.6; // how far above the words bubble: 1 = just touching, smaller = more merged
const NAME_PIC_INSET = 0.88; // the photo is this fraction of the picture bubble, so a white ring stays around it

type P = {x: number; y: number};
const bez = (a: P, c: P, b: P, u: number): P => ({
  x: (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * c.x + u * u * b.x,
  y: (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * c.y + u * u * b.y,
});

// Middle of the listed cells, in pixels
const centerOf = (cells: string[], w: number, h: number, n: number): P => {
  const r = cells.map((c) => cellRect(c, w, h, n));
  return {x: r.reduce((s, q) => s + q.cx, 0) / r.length, y: r.reduce((s, q) => s + q.cy, 0) / r.length};
};

// ---- CHAIN (change here; the chain window itself is a slider in the editor tab, JSON "chain") ----
const LINK_THICK = 0.55; // thickness of the link between chained bubbles, as a fraction of the ball
const CHAIN_GAP_CELLS = 0.25; // bubbles of one chain keep at least this much room between them, in grid cells

// ---- BUBBLE PLACEMENT (change here) ----
// The caption's cells are where the TAIL points. The bubble sits in a random direction from them, at a random distance:
// the tail is at least style.tail.maxLengthCells long, and up to (1 + PLACE_FAR) times that.
// "Random" is fixed per caption id (Remotion's random(seed)), so the preview and every render frame agree.
const PLACE_FAR = 2; // 0 = always the shortest tail, 2 = up to 3x as long
const PLACE_TRIES = 16; // directions tried until the bubble fits in the frame without being pushed back in

// Distance from the center of an ellipse to its edge, in direction (ux, uy) (a unit vector)
const edgeDist = (rx: number, ry: number, ux: number, uy: number) => 1 / Math.hypot(ux / rx, uy / ry);

// The whole edit is drawn from the JSON ("spec"): the props ARE the JSON, so --props=scripts/x.json works.
// videoSrc and pictureSrc are only set by the preview tab (files picked in the browser); a render uses public/<video.file> and public/<picture.file>.
export const ComicEdit = (spec: Spec & {videoSrc?: string; pictureSrc?: string}) => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const t = frame / fps;
  const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;
  const {style, timing: tm, captions, zooms} = spec; // pieces, not "spec" itself: the props object is new on every frame, its pieces are not
  const N = spec.grid.size;
  const normalScale = spec.bubbleScale?.normal ?? 1; // size slider of the normal bubbles (1 = as before); the whole bubble grows, words included
  const nameScale = spec.bubbleScale?.name ?? 1; // size slider of the name bubble; words, bubble and picture circle grow together

  const chainWindow = spec.chain && spec.chain.enabled !== false ? spec.chain.windowSeconds : 0; // 0 = no chain, one bubble at a time
  const groups = useMemo(() => chainGroups(captions, chainWindow), [captions, chainWindow]);
  const sch = useMemo(() => chainSchedule(captions, groups, tm), [captions, groups, tm]);
  if (frame === 0) console.log(`[Comic] chain: ${chainWindow ? `window ${chainWindow}s, groups ${groups.map((g) => g.map((k) => captions[k].id).join("+")).join(" | ")}` : "off"}`);
  const pictureUrl = spec.pictureSrc ?? (spec.picture ? staticFile(spec.picture.file) : undefined);
  if (frame === 0) console.log(`[Comic] bubble size: normal x${normalScale}, name x${nameScale}`);
  if (frame === 0) console.log(`[Comic] name bubble = caption #${NAME_BUBBLE_ID}, picture: ${pictureUrl ? (spec.pictureSrc ? "picked in the editor" : `public/${spec.picture?.file}`) : "NOT set (the top bubble stays empty)"}`);

  const geo = useMemo(() => {
    const cw = width / N;
    const margin = cw * 0.3;

    // One bubble at a given size. scale 1 = the original size. Words, bubble and picture circle all grow together around the center.
    const build = (cap: Caption, scale: number) => {
      const font = style.font.sizeCells * cw * scale;
      const lineH = font * 1.15;
      const lines = (style.font.capitals ? cap.text.toUpperCase() : cap.text).split(" "); // one word per line
      const longest = Math.max(...lines.map((l) => l.length));
      const isName = cap.id === NAME_BUBBLE_ID;
      const rx = ((longest * font * ADV) / 2) * BUBBLE_W_SCALE + font * BUBBLE_W_PAD; // bubble half-width
      const ry = ((lines.length * lineH) / 2) * BUBBLE_H_SCALE + font * BUBBLE_H_PAD; // bubble half-height
      const fs = isName ? font * NAME_TEXT_SCALE : font; // text size in px
      const lh = isName ? lineH * NAME_TEXT_SCALE : lineH; // distance between the lines

      // The tails point at the cells; the bubble sits in a random direction and distance from them (the first try that fits in the frame)
      const tips = cap.cells.map((name) => {
        const r = cellRect(name, width, height, N);
        return {x: r.cx, y: r.cy};
      });
      const target = centerOf(cap.cells, width, height, N);
      const overflow = (q: P) => Math.max(0, margin + rx - q.x) + Math.max(0, q.x + rx - (width - margin)) + Math.max(0, margin + ry - q.y) + Math.max(0, q.y + ry - (height - margin));
      let c = target;
      let best = Infinity;
      for (let a = 0; a < PLACE_TRIES && best > 0; a++) {
        const ang = random(`bubble-${cap.id}-dir-${a}`) * Math.PI * 2;
        const [ux, uy] = [Math.cos(ang), Math.sin(ang)];
        const away = cw * style.tail.maxLengthCells * (1 + random(`bubble-${cap.id}-far-${a}`) * PLACE_FAR) + edgeDist(rx, ry, ux, uy);
        const q = {x: target.x + ux * away, y: target.y + uy * away};
        if (overflow(q) < best) [c, best] = [q, overflow(q)]; // the try that sticks out of the frame the least
      }
      if (!isName) {
        // keep the bubble in the frame; the tail then stretches to reach its cell
        c = {x: Math.min(Math.max(c.x, margin + rx), width - margin - rx), y: Math.min(Math.max(c.y, margin + ry), height - margin - ry)};
      }

      let pic: {x: number; y: number; rp: number} | undefined; // the picture bubble of the name bubble
      if (isName) {
        const rp = NAME_PIC_CELLS * cw * scale;
        const textHalf = (longest * fs * ADV) / 2; // the big words can be wider than the bubble
        let px = c.x - rx * NAME_PIC_LEFT;
        let py = c.y - ry - rp * NAME_PIC_UP;
        const left = Math.min(c.x - Math.max(rx, textHalf), px - rp);
        const right = Math.max(c.x + Math.max(rx, textHalf), px + rp);
        const top = Math.min(c.y - ry, py - rp);
        const bottom = Math.max(c.y + ry, py + rp);
        const dx = left < margin ? margin - left : right > width - margin ? width - margin - right : 0; // keep both bubbles in the frame
        const dy = top < margin ? margin - top : bottom > height - margin ? height - margin - bottom : 0;
        c = {x: c.x + dx, y: c.y + dy};
        px += dx;
        py += dy;
        pic = {x: px, y: py, rp};
        console.log(`[Comic] #${cap.id} NAME BUBBLE x${scale}: words bubble ${(rx * 2).toFixed(0)}x${(ry * 2).toFixed(0)}px at ${c.x.toFixed(0)},${c.y.toFixed(0)}, tail to ${cap.cells.join("+")}, text ${fs.toFixed(0)}px, picture circle r=${rp.toFixed(0)}px at ${px.toFixed(0)},${py.toFixed(0)}${dx || dy ? `, moved ${dx.toFixed(0)},${dy.toFixed(0)} to fit the frame` : ""}`);
      } else console.log(`[Comic] #${cap.id} "${cap.text}" tail to ${cap.cells.join("+")}, bubble x${scale} ${(rx * 2).toFixed(0)}x${(ry * 2).toFixed(0)}px at ${c.x.toFixed(0)},${c.y.toFixed(0)}`);
      return {c, rx, ry, lines, fs, lh, pic, tips, target};
    };

    const items = captions.map((cap) => build(cap, cap.id === NAME_BUBBLE_ID ? nameScale : normalScale));

    // bubbles of one chain are on screen together: move a later bubble away from the earlier ones it would cover (its tails still reach its cells)
    const gap = cw * CHAIN_GAP_CELLS;
    groups.forEach((g) =>
      g.forEach((k, j) => {
        for (let pass = 0; pass < 3; pass++) {
          g.slice(0, j).forEach((i) => {
            const a = items[i];
            const b = items[k];
            const dx = b.c.x - a.c.x;
            const dy = b.c.y - a.c.y;
            const ox = a.rx + b.rx + gap - Math.abs(dx); // how much the two boxes overlap
            const oy = a.ry + b.ry + gap - Math.abs(dy);
            if (ox <= 0 || oy <= 0) return;
            const side = (d: number, mid: number, at: number) => (d !== 0 ? Math.sign(d) : at < mid ? 1 : -1);
            const mx = ox < oy ? side(dx, width / 2, b.c.x) * ox : 0; // the short way out
            const my = ox < oy ? 0 : side(dy, height / 2, b.c.y) * oy;
            const c = {x: Math.min(Math.max(b.c.x + mx, margin + b.rx), width - margin - b.rx), y: Math.min(Math.max(b.c.y + my, margin + b.ry), height - margin - b.ry)};
            const pic = b.pic && {...b.pic, x: b.pic.x + c.x - b.c.x, y: b.pic.y + c.y - b.c.y};
            items[k] = {...b, c, pic};
            console.log(`[Comic] chain: #${captions[k].id} moved ${(c.x - b.c.x).toFixed(0)},${(c.y - b.c.y).toFixed(0)}px away from #${captions[i].id}`);
          });
        }
      })
    );
    // smooth curve from each bubble to the next: control point bows to the upper side
    const hops = items.slice(0, -1).map((a, k) => {
      const b = items[k + 1];
      const len = Math.hypot(b.c.x - a.c.x, b.c.y - a.c.y) || 1;
      let nx = -(b.c.y - a.c.y) / len;
      let ny = (b.c.x - a.c.x) / len;
      if (ny > 0) [nx, ny] = [-nx, -ny];
      const C = {x: (a.c.x + b.c.x) / 2 + nx * len * 0.25, y: (a.c.y + b.c.y) / 2 + ny * len * 0.25};
      console.log(`[Comic] hop ${k + 1}->${k + 2} length ${len.toFixed(0)}px`);
      return {A: a.c, B: b.c, C};
    });
    const zoomList = [...zooms].sort((a, b) => a.from - b.from).map((z) => ({...z, origin: centerOf(z.cells, width, height, N)}));
    return {cw, items, hops, zooms: zoomList};
  }, [captions, style, zooms, N, width, height, normalScale, nameScale, groups]);

  // key moments, logged once each
  captions.forEach((cap, k) => {
    const s = sch[k];
    const marks: [string, number][] = [["words in", cap.from], ["words gone", s.out]];
    if (k < captions.length - 1) marks.push(["travel starts", s.out + tm.split.close * s.W], ["travel ends", s.out + (tm.split.close + tm.split.travel) * s.W]);
    marks.forEach(([name, tt]) => frame === Math.round(tt * fps) && console.log(`[Comic] #${cap.id} "${cap.text}" ${name} at ${tt.toFixed(3)}s (frame ${frame})`));
  });

  // zooms stack and hold; the origin is the latest zoom that has started
  let zoom = 1;
  geo.zooms.forEach((z) => (zoom *= 1 + (z.percent / 100) * interpolate(t, [z.from, z.to], [0, 1], {...clamp, easing: Easing.inOut(Easing.cubic)})));
  const live = [...geo.zooms].reverse().find((z) => t >= z.from) ?? geo.zooms[0];
  const origin = live ? live.origin : {x: width / 2, y: height / 2};

  // The camera moves are a list of steps in time order. Every step takes the camera from the scale the last step left it at to its own scale.
  //  - name effect (JSON "nameZoom"; the slider is in the editor tab): the video blurs, then zooms in toward the name bubble and holds;
  //    blur and zoom reset together, finishing just before the next text starts
  //  - captionZoom: at every NORMAL bubble (not the name bubble), alternating in, out, in, out...
  // A step is drawn as translate + scale around a focus point f (x' = f + s * (x - f)), so a new focus never makes the picture jump.
  type Step = {from: number; dur: number; to: number; f: P};
  const steps: Step[] = [];
  const nz = spec.nameZoom;
  const nameK = captions.findIndex((c) => c.id === NAME_BUBBLE_ID);
  let nameFx: {blurStart: number; resetStart: number; resetDur: number} | null = null;
  if (nz && nz.percent > 0 && nameK >= 0) {
    const g = geo.items[nameK];
    const f = g.pic ? {x: (g.c.x + g.pic.x) / 2, y: (g.c.y + g.pic.y) / 2} : g.c; // between the words bubble and its picture circle
    const blurStart = Math.max(0, captions[nameK].from - tm.firstOpenSeconds); // the name appears: the video starts to blur
    const zoomStart = blurStart + NAME_BLUR_SECONDS; // then the zoom
    const zoomEnd = zoomStart + nz.seconds;
    const nextFrom = captions[nameK + 1]?.from;
    const resetEnd = nextFrom !== undefined ? nextFrom - NAME_RESET_MARGIN : sch[nameK].out + nz.seconds; // back to normal before the next text
    const resetStart = Math.max(zoomEnd, resetEnd - nz.seconds);
    const resetDur = Math.max(0.05, Math.min(nz.seconds, resetEnd - resetStart));
    steps.push({from: zoomStart, dur: nz.seconds, to: 1 + nz.percent / 100, f});
    steps.push({from: resetStart, dur: resetDur, to: 1, f});
    nameFx = {blurStart, resetStart, resetDur};
    if (frame === Math.round(blurStart * fps)) console.log(`[Comic] name effect: blur ${blurStart.toFixed(3)}s, zoom ${zoomStart.toFixed(3)}-${zoomEnd.toFixed(3)}s (x${(1 + nz.percent / 100).toFixed(3)}), reset ${resetStart.toFixed(3)}-${(resetStart + resetDur).toFixed(3)}s`);
  }
  const cz = spec.captionZoom;
  if (cz && cz.enabled !== false) {
    let up = true; // the first normal bubble zooms in, the next one out, ...
    captions.forEach((cap, k) => {
      if (cap.id === NAME_BUBBLE_ID) return;
      steps.push({from: cap.from, dur: cz.seconds, to: up ? 1 + cz.percent / 100 : 1, f: geo.items[k].target}); // toward the action the tail points at
      up = !up;
    });
  }
  steps.sort((a, b) => a.from - b.from);

  let pulse = {s: 1, x: 0, y: 0};
  let cur = -1; // the last step that has started
  steps.forEach((st, i) => {
    if (t >= st.from) cur = i;
    if (frame === Math.round(st.from * fps)) console.log(`[Comic] camera step ${i + 1}/${steps.length} at ${st.from.toFixed(3)}s: to x${st.to.toFixed(3)}`);
  });
  if (cur >= 0) {
    const st = steps[cur];
    const prev = steps[cur - 1];
    const a = prev ? prev.to : 1; // the scale the camera is at when this step starts
    const dur = Math.max(Math.min(st.dur, (steps[cur + 1]?.from ?? Infinity) - st.from), 0.01); // never longer than the time to the next step
    const raw = Math.min(1, Math.max(0, (t - st.from) / dur));
    const e = Easing.inOut(Easing.cubic)(raw);
    const sc = a + (st.to - a) * e;
    // zooming in: the focus is this step's own spot. Zooming out: the focus glides from the last step's spot to this one's.
    const f = st.to > a || !prev ? st.f : {x: prev.f.x + (st.f.x - prev.f.x) * e, y: prev.f.y + (st.f.y - prev.f.y) * e};
    pulse = {s: sc, x: f.x * (1 - sc), y: f.y * (1 - sc)};
  }

  // the blur behind the name: ramps up first, stays while the zoom is held, ramps down together with the zoom reset
  let blurPx = 0;
  if (nameFx) {
    const ease = {...clamp, easing: Easing.inOut(Easing.cubic)};
    const up = interpolate(t, [nameFx.blurStart, nameFx.blurStart + NAME_BLUR_SECONDS], [0, 1], ease);
    const down = interpolate(t, [nameFx.resetStart, nameFx.resetStart + nameFx.resetDur], [1, 0], ease);
    blurPx = width * NAME_BLUR * Math.min(up, down);
  }

  // pop sound: the swell of the file plays while the ball inflates and the pop lands at the moment the ball is complete and bursts open into the bubble
  // (same moment as in blobsAt: first words minus firstOpenSeconds). The offset slider in the editor moves it. Audio starts on whole frames.
  const pop = spec.popSound;
  const popOn = !!pop && pop.enabled !== false;
  const popFrame = Math.round((captions[0].from - tm.firstOpenSeconds + (pop?.offsetSeconds ?? 0) - POP_HIT) * fps); // frame where the FILE starts (can be before 0)
  if (popOn && frame === Math.max(0, popFrame)) console.log(`[Comic] pop sound: file starts at frame ${popFrame}, the pop itself at ${((popFrame / fps) + POP_HIT).toFixed(3)}s (offset ${pop?.offsetSeconds ?? 0}s)`);

  // outro: where we are in it (u from 0 to 1), null before it starts or when it is off
  const outroSec = spec.outro?.secondsBeforeEnd ?? 0;
  const outroStart = durationInFrames / fps - outroSec;
  const outroU = outroSec > 0 && t >= outroStart ? (t - outroStart) / outroSec : null;
  const outroText = (spec.outro?.text ?? "MIRRORS").trim();
  const outroPopFrame = Math.round((outroStart + OUTRO_TEXT * outroSec - POP_HIT) * fps); // the pop lands as the text pops in
  if (outroSec > 0 && frame === Math.round(outroStart * fps)) console.log(`[Comic] outro starts at ${outroStart.toFixed(3)}s (${outroSec}s before the end), text "${outroText}" at ${(outroStart + OUTRO_TEXT * outroSec).toFixed(3)}s`);

  const fade = spec.ending.find((e) => e.type === "fadeToBlack");
  const fadeStart = durationInFrames - (fade ? fade.seconds * fps : 0);
  const endFade = fade ? interpolate(frame, [fadeStart, durationInFrames - 1], [1, 0], clamp) : 1;
  if (fade && frame === Math.round(fadeStart)) console.log(`[Comic] fade to black starts (frame ${frame} of ${durationInFrames})`);

  const blobs = blobsAt(t, captions, sch, groups, tm);
  const layered = [...blobs.filter((b) => b.kind === "link"), ...blobs.filter((b) => b.kind !== "link")]; // links under the bubbles
  const R = geo.cw * style.ballRadiusCells;
  const lw = geo.cw * style.outlineCells;

  // the whole bubble/ball/thread, drawn twice: wide in the ink color (the outline), then in the fill color
  const draw = (b: ChainBlob, color: string, grow: number) => {
    // chain link: runs out of the previous bubble along the same curve a hop uses, then stays as a band between the two bubbles
    if (b.kind === "link") {
      const h = geo.hops[b.k - 1];
      const w = R * LINK_THICK * b.v;
      if (w < 0.3) return null;
      const n = Math.max(2, Math.ceil(b.p * 40));
      const pts = Array.from({length: n + 1}, (_, i) => bez(h.A, h.C, h.B, (b.p * i) / n));
      const hp = pts[n];
      return (
        <>
          <path d={`M ${pts.map((q) => `${q.x} ${q.y}`).join(" L ")}`} fill="none" stroke={color} strokeWidth={2 * w + 2 * grow} strokeLinecap="round" strokeLinejoin="round" />
          {b.p < 1 && <circle cx={hp.x} cy={hp.y} r={R + grow} fill={color} />}
        </>
      );
    }
    if (b.kind === "cell") {
      const g = geo.items[b.k];
      const rx = (R + (g.rx - R) * b.o) * b.sc + grow * b.sc;
      const ry = (R + (g.ry - R) * b.o) * b.sc + grow * b.sc;

      // name bubble: the picture bubble starts inside the ball and moves up-left while it grows
      let pic = null;
      if (g.pic) {
        const rp = (R + (g.pic.rp - R) * b.o) * b.sc + grow * b.sc;
        pic = <circle cx={g.c.x + (g.pic.x - g.c.x) * b.o} cy={g.c.y + (g.pic.y - g.c.y) * b.o} r={rp} fill={color} />;
      }

      // comic tails: a thin curved spike from the bubble edge to each of the caption's cells, grows as the bubble opens
      const tails = !style.tail.enabled || b.o <= 0.02
        ? []
        : g.tips.map((tip0, i) => {
            const dx = tip0.x - g.c.x;
            const dy = tip0.y - g.c.y;
            const dist = Math.hypot(dx, dy) || 1;
            const phi = Math.atan2(g.rx * dy, g.ry * dx); // point of the ellipse that faces the cell
            const onEllipse = (a: number, k: number): P => ({x: g.c.x + k * g.rx * Math.cos(a), y: g.c.y + k * g.ry * Math.sin(a)});
            const base = onEllipse(phi, 1);
            const gap = Math.hypot(tip0.x - base.x, tip0.y - base.y) || 1;
            const reaches = dist > Math.hypot(base.x - g.c.x, base.y - g.c.y); // false when the bubble covers the cell: then no tail shows
            const L = reaches ? gap * b.o * b.sc : 0;
            if (L <= 0.5) return null;
            const d = {x: (tip0.x - base.x) / gap, y: (tip0.y - base.y) / gap};
            const b1 = onEllipse(phi - 0.35, 0.95); // base corners sit slightly inside, so the outline opens into the tail
            const b2 = onEllipse(phi + 0.35, 0.95);
            const tip = {x: base.x + d.x * L, y: base.y + d.y * L};
            const n = {x: -d.y, y: d.x};
            const c1 = {x: (b1.x + tip.x) / 2 + n.x * L * 0.18, y: (b1.y + tip.y) / 2 + n.y * L * 0.18};
            const c2 = {x: (b2.x + tip.x) / 2 + n.x * L * 0.18, y: (b2.y + tip.y) / 2 + n.y * L * 0.18};
            return <path key={i} d={`M ${b1.x} ${b1.y} Q ${c1.x} ${c1.y} ${tip.x} ${tip.y} Q ${c2.x} ${c2.y} ${b2.x} ${b2.y} Z`} fill={color} stroke={color} strokeWidth={2 * grow} strokeLinejoin="round" />;
          });
      return (
        <>
          {tails}
          {pic}
          <ellipse cx={g.c.x} cy={g.c.y} rx={rx} ry={ry} fill={color} />
        </>
      );
    }
    const h = geo.hops[b.k];
    const head = Easing.out(Easing.cubic)(b.p); // head runs ahead
    const back = Easing.in(Easing.cubic)(b.p); // tail lags, so the line stretches then gathers
    const th = 1 - 0.55 * Math.sin(Math.PI * b.p); // thinner while stretched
    const steps = Math.max(2, Math.ceil((head - back) * 40));
    const pts = Array.from({length: steps + 1}, (_, i) => bez(h.A, h.C, h.B, back + ((head - back) * i) / steps));
    const hp = bez(h.A, h.C, h.B, head);
    const tp = bez(h.A, h.C, h.B, back);
    return (
      <>
        <path d={`M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")}`} fill="none" stroke={color} strokeWidth={2 * R * th + 2 * grow} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={tp.x} cy={tp.y} r={R * th + grow} fill={color} />
        <circle cx={hp.x} cy={hp.y} r={R * (0.5 + 0.5 * th) + grow} fill={color} />
      </>
    );
  };

  // the outro bubble: one ellipse in the middle (outline + fill), the bouncing dots, then the text
  const outroLayer = () => {
    if (outroU === null) return null;
    const u = outroU;
    const ease = (from: number, to: number, e = Easing.inOut(Easing.cubic)) => interpolate(u, [from, to], [0, 1], {...clamp, easing: e});
    const rx0 = width * OUTRO_START_SIZE;
    const ry0 = rx0 * 0.72;
    const fill = ease(OUTRO_POP, OUTRO_FILL); // 0 = popped size, 1 = covers the screen (an ellipse 0.75 x the frame reaches past the corners)
    const pop = ease(0, OUTRO_POP, Easing.out(Easing.back(1.8)));
    const rx = (rx0 + (width * 0.75 - rx0) * fill) * pop;
    const ry = (ry0 + (height * 0.75 - ry0) * fill) * pop;
    const cx = width / 2;
    const cy = height / 2;

    const dotsOn = u >= OUTRO_POP * 0.6 && u < OUTRO_TEXT;
    const dotScale = 1 - ease(OUTRO_TEXT - 0.05, OUTRO_TEXT); // the dots shrink away just before the text
    const dotR = width * 0.025;
    const dots = dotsOn
      ? [0, 1, 2].map((i) => {
          const bounce = Math.max(0, Math.sin(2 * Math.PI * (t * 2.5) - i * 0.9)) * dotR * 1.2; // typing dots, one after the other
          return <circle key={i} cx={cx + (i - 1) * dotR * 3} cy={cy - bounce} r={dotR * dotScale} fill={style.ink} />;
        })
      : null;

    const fs = Math.min((width * 0.85) / (outroText.length * ADV), height * 0.16);
    const textP = ease(OUTRO_TEXT, OUTRO_TEXT + OUTRO_TEXT_POP, Easing.out(Easing.back(2.5)));
    const text =
      u >= OUTRO_TEXT ? (
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontFamily={fontFamily} fontWeight={700} fontSize={fs} fill={style.ink} transform={`translate(${cx} ${cy}) scale(${Math.max(textP, 0.001)}) translate(${-cx} ${-cy})`}>
          {outroText}
        </text>
      ) : null;

    return (
      <g>
        <ellipse cx={cx} cy={cy} rx={rx + lw} ry={ry + lw} fill={style.ink} />
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={style.fill} />
        {dots}
        {text}
      </g>
    );
  };

  // impact bursts: behind the bubbles of the captions listed in "impact.captions" (missing = the first normal caption), as big as size x the bubble width
  const impactSize = spec.impact?.size ?? 0;
  const impactIds = spec.impact?.captions ?? [captions.find((c) => c.id !== NAME_BUBBLE_ID)?.id ?? captions[0].id];
  const impactLayer = () =>
    impactSize > 0
      ? blobs.map((b, i) => {
          if (b.kind !== "cell" || !impactIds.includes(captions[b.k].id)) return null;
          const g = geo.items[b.k];
          const d = impactSize * 2 * g.rx * b.o * b.sc; // grows and shrinks with its bubble
          if (d < 2) return null;
          const turn = random(`impact-${captions[b.k].id}`) * 360; // every burst turned its own way
          return (
            <foreignObject key={`impact${i}`} x={g.c.x - d / 2} y={g.c.y - d / 2} width={d} height={d}>
              <Img src={staticFile(IMPACT_FILE)} style={{width: "100%", height: "100%", objectFit: "contain", transform: `rotate(${turn}deg)`, filter: `drop-shadow(0 0 ${Math.max(1, lw)}px ${style.ink})`}} />
            </foreignObject>
          );
        })
      : null;

  // the photo inside the picture bubble (a Remotion <Img> inside the SVG, so a render waits until it is loaded)
  const pictureLayer = () => {
    const blob = blobs.find((b) => b.kind === "cell" && geo.items[b.k].pic);
    if (!blob || blob.kind !== "cell" || !pictureUrl) return null;
    const g = geo.items[blob.k];
    if (!g.pic) return null;
    const px = g.c.x + (g.pic.x - g.c.x) * blob.o;
    const py = g.c.y + (g.pic.y - g.c.y) * blob.o;
    const r = (R + (g.pic.rp - R) * blob.o) * blob.sc * NAME_PIC_INSET;
    const a = Math.max(0, Math.min(1, (blob.o - 0.7) / 0.3)); // the photo fades in when the bubble is nearly open
    if (a <= 0 || r < 2) return null;
    return (
      <foreignObject x={px - r} y={py - r} width={2 * r} height={2 * r} style={{opacity: a}}>
        <div style={{width: "100%", height: "100%", borderRadius: "50%", overflow: "hidden"}}>
          <Img src={pictureUrl} style={{width: "100%", height: "100%", objectFit: "cover"}} />
        </div>
      </foreignObject>
    );
  };

  return (
    <AbsoluteFill style={{background: "black"}}>
      {outroSec > 0 && (
        <Sequence from={Math.max(0, outroPopFrame)}>
          <Audio src={staticFile(POP_FILE)} startFrom={Math.max(0, -outroPopFrame)} volume={POP_VOLUME} />
        </Sequence>
      )}
      {popOn && (
        <Sequence from={Math.max(0, popFrame)}>
          <Audio src={staticFile(POP_FILE)} startFrom={Math.max(0, -popFrame)} volume={POP_VOLUME} />
        </Sequence>
      )}
      <AbsoluteFill style={{opacity: endFade, filter: blurPx > 0.05 ? `blur(${blurPx.toFixed(2)}px)` : undefined}}>
        <AbsoluteFill style={{transform: `translate(${pulse.x}px, ${pulse.y}px) scale(${pulse.s})`, transformOrigin: "0 0"}}>
          <AbsoluteFill style={{transform: `scale(${zoom})`, transformOrigin: `${origin.x}px ${origin.y}px`}}>
            <OffthreadVideo src={spec.videoSrc ?? staticFile(spec.video.file)} style={{width, height}} />
          </AbsoluteFill>
        </AbsoluteFill>
      </AbsoluteFill>

      <svg width={width} height={height} style={{position: "absolute", inset: 0}}>
        {impactLayer()}
        {blobs.length > 0 && (
          <g>
            {/* links first, so the bubbles sit on top of them; the ink pass first, so the fill pass hides the outline where a link enters a bubble */}
            {layered.map((b, i) => (
              <g key={`ink${i}`}>{draw(b, style.ink, lw)}</g>
            ))}
            {layered.map((b, i) => (
              <g key={`fill${i}`}>{draw(b, style.fill, 0)}</g>
            ))}
          </g>
        )}
        {pictureLayer()}

        {captions.map((cap, k) => {
          const out = sch[k].out;
          if (t < cap.from || t >= out) return null;
          const span = Math.max(cap.to - cap.from, 0.05);
          const exit = interpolate(t, [out - tm.exitFadeSeconds, out], [1, 0], clamp);
          const {c, lines, fs, lh, pic} = geo.items[k];
          const isName = !!pic;
          const rows = lines.map((line, li) => {
            const t0 = cap.from + (lines.length > 1 ? li / (lines.length - 1) : 0) * 0.4 * span; // soft stagger, one word at a time
            const p = interpolate(t, [t0, t0 + 0.6 * span], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
            if (p <= 0) return null;
            const common = {
              x: c.x,
              y: c.y + (li - (lines.length - 1) / 2) * lh + (1 - p) * fs * 0.25,
              textAnchor: "middle",
              dominantBaseline: "central",
              fontFamily,
              fontWeight: 700,
              fontSize: fs,
            } as const;
            // name bubble words: fill color with a thick ink outline and an offset shadow, like a POW burst
            return isName ? (
              <g key={`${k}-${li}`} opacity={p * exit}>
                <text {...common} transform={`translate(${fs * 0.05} ${fs * 0.07})`} fill={style.ink} stroke={style.ink} strokeWidth={fs * 0.2} strokeLinejoin="round">
                  {line}
                </text>
                <text {...common} fill={style.fill} stroke={style.ink} strokeWidth={fs * 0.14} strokeLinejoin="round" paintOrder="stroke">
                  {line}
                </text>
              </g>
            ) : (
              <text key={`${k}-${li}`} {...common} opacity={p * exit} fill={style.ink}>
                {line}
              </text>
            );
          });
          return (
            <g key={k} transform={isName && NAME_TEXT_TILT ? `rotate(${NAME_TEXT_TILT} ${c.x} ${c.y})` : undefined}>
              {rows}
            </g>
          );
        })}
        {outroLayer()}
      </svg>
    </AbsoluteFill>
  );
};