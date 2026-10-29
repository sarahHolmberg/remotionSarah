// app/grid.tsx
// NEW FILE: the grid drawn over the video in the preview (only there: it is not part of the exported video).
// Same naming as src/gridCell.ts: letter = column (A = left), number = row (1 = top), so a 20x20 grid runs from A1 to T20.
// The size is the JSON's grid.size, so the cells you read here are the cells the bubbles use.
// While a bubble is being edited: its cells are highlighted, and a click on the video picks a cell (onCell; Shift = add/remove).

import type {MouseEvent} from "react";

type Props = {n: number; w: number; h: number; highlight?: string[]; onCell?: (cell: string, add: boolean) => void};

export const GridOverlay = ({n, w, h, highlight = [], onCell}: Props) => {
  const cw = w / n;
  const ch = h / n;
  const fs = Math.min(cw, ch) * 0.26; // label size
  const lines = Array.from({length: n - 1}, (_, i) => i + 1);
  const line = (key: string, x1: number, y1: number, x2: number, y2: number) => (
    <g key={key}>
      {/* dark under light, so the lines show on bright and dark video */}
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#000" strokeOpacity={0.45} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff" strokeOpacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </g>
  );
  const click = (e: MouseEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const col = Math.min(n - 1, Math.floor(((e.clientX - b.left) / b.width) * n));
    const row = Math.min(n - 1, Math.floor(((e.clientY - b.top) / b.height) * n));
    onCell?.(`${String.fromCharCode(65 + col)}${row + 1}`, e.shiftKey);
  };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" onClick={onCell ? click : undefined} style={{position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: onCell ? "auto" : "none", cursor: onCell ? "crosshair" : undefined}}>
      {highlight.map((cell) => {
        const col = cell.charCodeAt(0) - 65;
        const row = Number(cell.slice(1)) - 1;
        return <rect key={cell} x={col * cw} y={row * ch} width={cw} height={ch} fill="#f8b636" fillOpacity={0.55} stroke="#f8b636" strokeWidth={2} vectorEffect="non-scaling-stroke" />;
      })}
      {lines.map((i) => line(`v${i}`, i * cw, 0, i * cw, h))}
      {lines.map((i) => line(`h${i}`, 0, i * ch, w, i * ch))}
      {Array.from({length: n * n}, (_, k) => {
        const col = k % n;
        const row = Math.floor(k / n);
        return (
          <text key={k} x={col * cw + fs * 0.25} y={row * ch + fs * 1.05} fontSize={fs} fontFamily="system-ui, sans-serif" fontWeight={700} fill="#fff" fillOpacity={0.8} stroke="#000" strokeOpacity={0.6} strokeWidth={fs * 0.12} paintOrder="stroke">
            {String.fromCharCode(65 + col)}
            {row + 1}
          </text>
        );
      })}
    </svg>
  );
};
