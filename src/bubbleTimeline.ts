// src/bubbleTimeline.ts
// NOT NEW: existing file, changed (chaining removed again: back to the version from before the chaining; a caption can now have an exact "out" time)

// Where is the ONE bubble at time t? Pure math (no Remotion) so it can be tested on its own.
import type {Timing} from "./spec";

export type Item = {text: string; from: number; to: number; center: string; tail?: string}; // used by the older test files
export type Span = {from: number; to: number; out?: number | "default"}; // out as a number = words gone exactly then
export type Blob =
  | {kind: "cell"; k: number; o: number; sc: number} // o: 0 = ball, 1 = full bubble; sc: pop-in/out scale
  | {kind: "thread"; k: number; p: number}; // flowing from cell k to cell k+1, p = 0..1

// The values the first two bubble tests used; also the defaults when no timing is passed.
export const DEFAULT_TIMING: Timing = {
  exitFadeSeconds: 0.05,
  gapBeforeNextSeconds: 0.5,
  lastHoldSeconds: 0.6,
  firstBallPopSeconds: 0.15,
  firstOpenSeconds: 0.15,
  endCloseSeconds: 0.15,
  endShrinkSeconds: 0.15,
  split: {close: 0.25, travel: 0.5, open: 0.25},
};
export const EXIT = DEFAULT_TIMING.exitFadeSeconds;

const ease = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2; // in-out cubic
};

// out = words fully gone; W = time left until the next words start (split into close, travel, open)
export const schedule = (items: Span[], tm: Timing = DEFAULT_TIMING) =>
  items.map((it, i) => {
    const next = items[i + 1];
    const out = typeof it.out === "number" ? it.out : next ? Math.max(it.to + tm.exitFadeSeconds, next.from - tm.gapBeforeNextSeconds) : it.to + tm.lastHoldSeconds;
    const W = next ? Math.max(next.from - out, 0.02) : 0;
    return {out, W};
  });

export const blobAt = (t: number, items: Span[], sch: {out: number; W: number}[], tm: Timing = DEFAULT_TIMING): Blob | null => {
  const {close, travel} = tm.split;
  const f0 = items[0].from - tm.firstOpenSeconds;
  const pop = Math.max(tm.firstBallPopSeconds, 0.001);
  if (t < f0 - pop) return null;
  if (t < f0) return {kind: "cell", k: 0, o: 0, sc: ease((t - (f0 - pop)) / pop)};
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    const s = sch[k];
    const last = k === items.length - 1;
    const openStart = k === 0 ? f0 : sch[k - 1].out + (close + travel) * sch[k - 1].W;
    if (t >= openStart && t < it.from) return {kind: "cell", k, o: ease((t - openStart) / (it.from - openStart)), sc: 1};
    if (t >= it.from && t < s.out) return {kind: "cell", k, o: 1, sc: 1};
    if (last) {
      const c = Math.max(tm.endCloseSeconds, 0.001);
      const h = Math.max(tm.endShrinkSeconds, 0.001);
      if (t < s.out + c) return {kind: "cell", k, o: 1 - ease((t - s.out) / c), sc: 1};
      if (t < s.out + c + h) return {kind: "cell", k, o: 0, sc: 1 - ease((t - s.out - c) / h)};
      return null;
    }
    if (t < s.out + close * s.W) return {kind: "cell", k, o: 1 - ease((t - s.out) / (close * s.W)), sc: 1};
    if (t < s.out + (close + travel) * s.W) return {kind: "thread", k, p: (t - s.out - close * s.W) / (travel * s.W)};
  }
  return null;
};