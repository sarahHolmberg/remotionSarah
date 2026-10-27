// src/bubbleTimeline.ts
// NOT NEW: existing file, changed (adds the chain: chainGroups, chainSchedule, blobsAt; blobAt and schedule are unchanged for the older compositions)

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

// ---- CHAIN: bubbles that start close together stay up together, linked like a chain ----
// A group starts at a caption; every next caption that starts within windowSeconds of the group's FIRST caption joins it.
// In a group: the first bubble arrives as always, each next one is reached by a link that runs out of the previous bubble.
// All bubbles of the group stay until the group ends, then they all close together and the last one travels on to the next group.
// windowSeconds 0 = no chain (every caption is its own group = the old behavior).
export const CHAIN_LINK_SECONDS = 0.45; // longest time the link runs + the new bubble opens, before its words start

export const chainGroups = (items: Span[], windowSeconds: number): number[][] => {
  const groups: number[][] = [];
  items.forEach((it, k) => {
    const g = groups[groups.length - 1];
    if (g && windowSeconds > 0 && it.from - items[g[0]].from <= windowSeconds) g.push(k);
    else groups.push([k]);
  });
  return groups;
};

// Like schedule(), but every bubble of a group keeps its words until the group's last bubble is done.
// Only the last bubble of a group has a W (the time to close and travel to the next group).
export const chainSchedule = (items: Span[], groups: number[][], tm: Timing = DEFAULT_TIMING) => {
  const single = schedule(items, tm);
  const sch = single.map((s) => ({...s}));
  groups.forEach((g) => {
    const last = g[g.length - 1];
    g.forEach((k) => {
      sch[k].out = single[last].out;
      sch[k].W = k === last ? single[last].W : 0;
    });
  });
  return sch;
};

export type ChainBlob = Blob | {kind: "link"; k: number; p: number; v: number}; // link from bubble k-1 to bubble k: p = how far it has run (0..1), v = thickness (1 = full, 0 = gone)

// Every shape on screen at time t (several bubbles and links while a group is up)
export const blobsAt = (t: number, items: Span[], sch: {out: number; W: number}[], groups: number[][], tm: Timing = DEFAULT_TIMING): ChainBlob[] => {
  const {close, travel, open} = tm.split;
  const tf = travel + open > 0 ? travel / (travel + open) : 0.5; // share of the link time spent running, the rest opens the bubble
  const f0 = items[0].from - tm.firstOpenSeconds;
  const pop = Math.max(tm.firstBallPopSeconds, 0.001);
  if (t < f0 - pop) return [];
  if (t < f0) return [{kind: "cell", k: 0, o: 0, sc: ease((t - (f0 - pop)) / pop)}];

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const first = g[0];
    const lastK = g[g.length - 1];
    const s = sch[lastK];
    const isLastGroup = gi === groups.length - 1;
    const openStart = gi === 0 ? f0 : sch[first - 1].out + (close + travel) * sch[first - 1].W;
    if (t < openStart) return []; // only during a hop, which the group before already handled

    // 1. the group is up: the first bubble opens, the others are reached by links one after the other
    if (t < s.out) {
      const out: ChainBlob[] = [];
      g.forEach((k, j) => {
        const it = items[k];
        if (j === 0) {
          out.push({kind: "cell", k, o: t < it.from ? ease((t - openStart) / Math.max(it.from - openStart, 0.001)) : 1, sc: 1});
          return;
        }
        const linkStart = Math.max(items[k - 1].to, it.from - CHAIN_LINK_SECONDS);
        const dur = Math.max(it.from - linkStart, 0.02);
        const ranOut = linkStart + dur * tf;
        if (t < linkStart) return;
        out.push({kind: "link", k, p: Math.min(1, ease((t - linkStart) / (dur * tf))), v: 1});
        if (t >= ranOut) out.push({kind: "cell", k, o: t < it.from ? ease((t - ranOut) / Math.max(it.from - ranOut, 0.001)) : 1, sc: 1});
      });
      return out;
    }

    // 2. the group closes: the last bubble turns back into the ball, the others and the links shrink away
    const cDur = Math.max(isLastGroup ? tm.endCloseSeconds : close * s.W, 0.001);
    if (t < s.out + cDur) {
      const c = ease((t - s.out) / cDur);
      return g.flatMap((k, j): ChainBlob[] => {
        const cell: ChainBlob = k === lastK ? {kind: "cell", k, o: 1 - c, sc: 1} : {kind: "cell", k, o: 1 - c, sc: 1 - c};
        return j === 0 ? [cell] : [{kind: "link", k, p: 1, v: 1 - c}, cell];
      });
    }
    if (isLastGroup) {
      const h = Math.max(tm.endShrinkSeconds, 0.001);
      if (t < s.out + cDur + h) return [{kind: "cell", k: lastK, o: 0, sc: 1 - ease((t - s.out - cDur) / h)}];
      return [];
    }

    // 3. the ball travels on to the next group (the same hop as without the chain)
    if (t < s.out + (close + travel) * s.W) return [{kind: "thread", k: lastK, p: (t - s.out - close * s.W) / (travel * s.W)}];
  }
  return [];
};