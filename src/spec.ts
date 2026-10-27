// src/spec.ts
// NOT NEW: existing file, changed (feature 4: adds the optional "popSound" {enabled, offsetSeconds} and POP_SOUND, the limits of the sound offset slider in the editor tab; features 1 to 3 are unchanged)

// The JSON contract: types + checks. Used by the render, the editor tab and the preview tab (one copy only).
export type Timing = {
  exitFadeSeconds: number;
  gapBeforeNextSeconds: number;
  lastHoldSeconds: number;
  firstBallPopSeconds: number;
  firstOpenSeconds: number;
  endCloseSeconds: number;
  endShrinkSeconds: number;
  split: {close: number; travel: number; open: number};
};
// cells: where the tail points (one tail per cell); the bubble is placed beside them. tail: still accepted, not used any more.
export type Caption = {id: number; text: string; from: number; to: number; cells: string[]; mode: "center"; out: "default" | number; tail?: string};
export type Zoom = {from: number; to: number; percent: number; cells: string[]; hold: true};
export type BubbleScale = {normal: number; name: number}; // 1 = the size the bubbles always had
export type Spec = {
  version: 1;
  video: {file: string};
  picture?: {file: string}; // optional: the photo for the name bubble (a file name in the public folder)
  grid: {size: number};
  fps: number;
  style: {
    type: "comic-bubble";
    fill: string;
    ink: string;
    font: {family: string; weight: number; sizeCells: number; capitals: boolean};
    outlineCells: number;
    ballRadiusCells: number;
    // the tails point at each caption's cells; maxLengthCells = how far the bubble sits from them.
    // defaultTarget and reach are still accepted so older JSON keeps working, but nothing uses them any more.
    tail: {enabled: boolean; defaultTarget: string; maxLengthCells: number; reach: number};
  };
  timing: Timing;
  captions: Caption[];
  zooms: Zoom[];
  ending: {type: "fadeToBlack"; seconds: number}[];
  captionZoom?: {enabled?: boolean; percent: number; seconds: number}; // optional: at every NORMAL bubble the camera nudges in, then out, then in... (enabled missing = on, false = off)
  nameZoom?: {percent: number; seconds: number}; // optional: extra zoom (with blur) toward the name bubble while it is on screen; percent 0 = off
  popSound?: {enabled?: boolean; offsetSeconds: number}; // optional: the bubble pop sound at the first bubble; offset moves it earlier (-) or later (+); enabled missing = on, false = off
  bubbleScale?: BubbleScale; // optional: size of the normal bubbles and of the name bubble (the whole bubble grows: words, bubble, picture circle; the tail tip stays where it points)
};

// Limits of the bubble size sliders (the editor tab uses the same numbers)
export const BUBBLE_SCALE = {min: 0.7, max: 2.5, step: 0.05, default: 1};

// Limits and start values of the zoom slider / checkbox (the editor tab uses the same numbers)
export const CAPTION_ZOOM = {min: 0.5, max: 10, step: 0.5, defaultPercent: 3, defaultSeconds: 0.3};

// Limits and start values of the name zoom slider (the preview tab uses the same numbers)
export const NAME_ZOOM = {min: 0, max: 15, step: 0.5, defaultPercent: 4, defaultSeconds: 0.5};

// Limits of the pop sound offset slider (the editor tab uses the same numbers)
export const POP_SOUND = {min: -0.5, max: 0.5, step: 0.01, defaultOffset: 0};

const FONTS = ["Comic Neue"]; // fonts the renderer knows
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isHex = (x: unknown) => typeof x === "string" && /^#[0-9a-fA-F]{6}$/.test(x);
const isObj = (x: unknown): x is Record<string, any> => typeof x === "object" && x !== null && !Array.isArray(x);
const cellOk = (c: unknown, n: number) => {
  if (typeof c !== "string" || !/^[A-Z][0-9]{1,2}$/.test(c)) return false;
  const col = c.charCodeAt(0) - 64;
  const row = Number(c.slice(1));
  return col >= 1 && col <= n && row >= 1 && row <= n;
};

// Returns every problem found. errors block the render, warnings do not.
export const validateSpec = (raw: unknown): {errors: string[]; warnings: string[]} => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const keys = (o: Record<string, any>, allowed: string[], where: string) =>
    Object.keys(o).forEach((k) => allowed.includes(k) || errors.push(`${where}: unknown field "${k}"`));
  const num = (v: unknown, where: string, min = 0, max = Infinity) => {
    if (!isNum(v) || v < min || v > max) errors.push(`${where}: must be a number from ${min} to ${max === Infinity ? "any" : max}`);
  };

  if (!isObj(raw)) return {errors: ["the JSON must be an object { ... }"], warnings};
  const s = raw;
  keys(s, ["version", "video", "picture", "grid", "fps", "style", "timing", "captions", "zooms", "ending", "captionZoom", "nameZoom", "popSound", "bubbleScale"], "top level");
  if (s.version !== 1) errors.push("version: must be 1");
  if (!isObj(s.video) || typeof s.video.file !== "string" || !s.video.file || /[\\/]|\.\./.test(s.video.file)) errors.push("video.file: must be a file name inside the public folder (no slashes)");
  if (s.picture !== undefined && (!isObj(s.picture) || typeof s.picture.file !== "string" || !s.picture.file || /[\\/]|\.\./.test(s.picture.file))) errors.push("picture.file: must be a file name inside the public folder (no slashes)");
  if (!isObj(s.grid) || !Number.isInteger(s.grid.size) || s.grid.size < 2 || s.grid.size > 26) errors.push("grid.size: must be a whole number from 2 to 26");
  num(s.fps, "fps", 1, 120);
  const n = isObj(s.grid) && Number.isInteger(s.grid.size) ? s.grid.size : 15;

  // style
  const st = s.style;
  if (!isObj(st)) errors.push("style: missing");
  else {
    keys(st, ["type", "fill", "ink", "font", "outlineCells", "ballRadiusCells", "tail"], "style");
    if (st.type !== "comic-bubble") errors.push('style.type: only "comic-bubble" exists');
    if (!isHex(st.fill)) errors.push("style.fill: must be a color like #FFFFFF");
    if (!isHex(st.ink)) errors.push("style.ink: must be a color like #000000");
    num(st.outlineCells, "style.outlineCells", 0.001, 0.5);
    num(st.ballRadiusCells, "style.ballRadiusCells", 0.01, 2);
    if (!isObj(st.font)) errors.push("style.font: missing");
    else {
      keys(st.font, ["family", "weight", "sizeCells", "capitals"], "style.font");
      if (!FONTS.includes(st.font.family)) errors.push(`style.font.family: must be one of ${FONTS.join(", ")}`);
      if (st.font.weight !== 700) errors.push("style.font.weight: only 700 is available");
      num(st.font.sizeCells, "style.font.sizeCells", 0.05, 3);
      if (typeof st.font.capitals !== "boolean") errors.push("style.font.capitals: must be true or false");
    }
    if (!isObj(st.tail)) errors.push("style.tail: missing");
    else {
      keys(st.tail, ["enabled", "defaultTarget", "maxLengthCells", "reach"], "style.tail");
      if (typeof st.tail.enabled !== "boolean") errors.push("style.tail.enabled: must be true or false");
      if (!cellOk(st.tail.defaultTarget, n)) errors.push("style.tail.defaultTarget: not a cell on the grid");
      num(st.tail.maxLengthCells, "style.tail.maxLengthCells", 0, 10);
      num(st.tail.reach, "style.tail.reach", 0, 1);
    }
  }

  // timing
  const tm = s.timing;
  if (!isObj(tm)) errors.push("timing: missing");
  else {
    keys(tm, ["exitFadeSeconds", "gapBeforeNextSeconds", "lastHoldSeconds", "firstBallPopSeconds", "firstOpenSeconds", "endCloseSeconds", "endShrinkSeconds", "split"], "timing");
    ["exitFadeSeconds", "gapBeforeNextSeconds", "lastHoldSeconds", "firstBallPopSeconds", "firstOpenSeconds", "endCloseSeconds", "endShrinkSeconds"].forEach((k) => num(tm[k], `timing.${k}`, 0, 30));
    if (!isObj(tm.split)) errors.push("timing.split: missing");
    else {
      keys(tm.split, ["close", "travel", "open"], "timing.split");
      const p = [tm.split.close, tm.split.travel, tm.split.open];
      if (!p.every((x) => isNum(x) && x >= 0) || Math.abs(p.reduce((a, b) => a + b, 0) - 1) > 1e-6) errors.push("timing.split: close + travel + open must be numbers that add up to 1");
    }
  }

  // captions
  const caps = s.captions;
  if (!Array.isArray(caps) || caps.length === 0) errors.push("captions: must be a list with at least one caption");
  else {
    const ids = new Set<number>();
    caps.forEach((c: any, i: number) => {
      const w = `caption ${i + 1}`;
      if (!isObj(c)) return errors.push(`${w}: must be an object`);
      keys(c, ["id", "text", "from", "to", "cells", "mode", "out", "tail"], w);
      if (!Number.isInteger(c.id) || ids.has(c.id)) errors.push(`${w}: id must be a whole number nobody else uses`);
      ids.add(c.id);
      if (typeof c.text !== "string" || !c.text.trim()) errors.push(`${w}: words are missing`);
      num(c.from, `${w}.from`);
      num(c.to, `${w}.to`);
      if (isNum(c.from) && isNum(c.to) && c.from >= c.to) errors.push(`${w}: "from" must be smaller than "to"`);
      if (!Array.isArray(c.cells) || c.cells.length === 0 || !c.cells.every((x: unknown) => cellOk(x, n))) errors.push(`${w}.cells: needs at least one cell that exists on the ${n}x${n} grid (A1 to ${String.fromCharCode(64 + n)}${n})`);
      if (c.mode !== "center") errors.push(`${w}.mode: only "center" is supported`);
      if (c.out !== "default") {
        const nx = caps[i + 1];
        if (!isNum(c.out) || !isNum(c.to) || c.out <= c.to) errors.push(`${w}.out: must be "default" or a time later than "to"`);
        else if (isObj(nx) && isNum(nx.from) && c.out > nx.from) errors.push(`${w}.out: ${c.out} is after the next caption starts (${nx.from})`);
      }
      if (c.tail !== undefined && !cellOk(c.tail, n)) errors.push(`${w}.tail: not a cell on the grid`);
      const prev = caps[i - 1];
      if (i > 0 && isObj(prev) && isNum(prev.to) && isNum(c.from)) {
        if (c.from <= prev.to) errors.push(`${w}: starts at ${c.from}, before the previous caption is fully in (${prev.to})`);
        else if (c.from - prev.to < 0.2) warnings.push(`${w}: only ${(c.from - prev.to).toFixed(3)}s after the previous caption, the bubble will flick instead of flow`);
      }
    });
  }

  // zooms
  if (!Array.isArray(s.zooms)) errors.push("zooms: must be a list (it can be empty)");
  else
    s.zooms.forEach((z: any, i: number) => {
      const w = `zoom ${i + 1}`;
      if (!isObj(z)) return errors.push(`${w}: must be an object`);
      keys(z, ["from", "to", "percent", "cells", "hold"], w);
      num(z.from, `${w}.from`);
      num(z.to, `${w}.to`);
      if (isNum(z.from) && isNum(z.to) && z.from >= z.to) errors.push(`${w}: "from" must be smaller than "to"`);
      num(z.percent, `${w}.percent`, 0.1, 100);
      if (!Array.isArray(z.cells) || z.cells.length === 0 || !z.cells.every((x: unknown) => cellOk(x, n))) errors.push(`${w}.cells: needs cells that exist on the grid`);
      if (z.hold !== true) errors.push(`${w}.hold: only true is supported (the zoom stays)`);
    });

  // ending
  if (!Array.isArray(s.ending)) errors.push("ending: must be a list (it can be empty)");
  else {
    if (s.ending.length > 1) errors.push("ending: only one step is supported");
    s.ending.forEach((e: any, i: number) => {
      const w = `ending step ${i + 1}`;
      if (!isObj(e)) return errors.push(`${w}: must be an object`);
      keys(e, ["type", "seconds"], w);
      if (e.type !== "fadeToBlack") errors.push(`${w}.type: only "fadeToBlack" is supported`);
      num(e.seconds, `${w}.seconds`, 0.1, 30);
    });
  }

  // captionZoom (optional)
  if (s.captionZoom !== undefined) {
    if (!isObj(s.captionZoom)) errors.push("captionZoom: must be an object");
    else {
      keys(s.captionZoom, ["enabled", "percent", "seconds"], "captionZoom");
      if (s.captionZoom.enabled !== undefined && typeof s.captionZoom.enabled !== "boolean") errors.push("captionZoom.enabled: must be true or false");
      num(s.captionZoom.percent, "captionZoom.percent", 0.1, 20);
      num(s.captionZoom.seconds, "captionZoom.seconds", 0.05, 2);
    }
  }

  // nameZoom (optional)
  if (s.nameZoom !== undefined) {
    if (!isObj(s.nameZoom)) errors.push("nameZoom: must be an object");
    else {
      keys(s.nameZoom, ["percent", "seconds"], "nameZoom");
      num(s.nameZoom.percent, "nameZoom.percent", 0, 30);
      num(s.nameZoom.seconds, "nameZoom.seconds", 0.05, 3);
    }
  }

  // popSound (optional)
  if (s.popSound !== undefined) {
    if (!isObj(s.popSound)) errors.push('popSound: must be an object like {"enabled": true, "offsetSeconds": 0}');
    else {
      keys(s.popSound, ["enabled", "offsetSeconds"], "popSound");
      if (s.popSound.enabled !== undefined && typeof s.popSound.enabled !== "boolean") errors.push("popSound.enabled: must be true or false");
      num(s.popSound.offsetSeconds, "popSound.offsetSeconds", POP_SOUND.min, POP_SOUND.max);
    }
  }

  // bubbleScale (optional): both numbers are needed when it is there
  if (s.bubbleScale !== undefined) {
    if (!isObj(s.bubbleScale)) errors.push('bubbleScale: must be an object like {"normal": 1, "name": 1}');
    else {
      keys(s.bubbleScale, ["normal", "name"], "bubbleScale");
      num(s.bubbleScale.normal, "bubbleScale.normal", BUBBLE_SCALE.min, BUBBLE_SCALE.max);
      num(s.bubbleScale.name, "bubbleScale.name", BUBBLE_SCALE.min, BUBBLE_SCALE.max);
    }
  }
  return {errors, warnings};
};

// Needs the real video length, so it runs after the video is known.
export const validateAgainstVideo = (spec: Spec, seconds: number): string[] => {
  const errors: string[] = [];
  spec.captions.forEach((c) => c.to > seconds && errors.push(`caption ${c.id}: ends at ${c.to}s but the video is only ${seconds.toFixed(3)}s long`));
  spec.zooms.forEach((z, i) => z.to > seconds && errors.push(`zoom ${i + 1}: ends at ${z.to}s but the video is only ${seconds.toFixed(3)}s long`));
  spec.ending.forEach((e) => e.seconds > seconds && errors.push(`ending: fade of ${e.seconds}s is longer than the video`));
  return errors;
};