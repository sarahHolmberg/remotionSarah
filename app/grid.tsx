// app/grid.tsx
// NEW FILE: the grid drawn over the video in the preview tab (only there: it is not part of the exported video).
// Same naming as src/gridCell.ts: letter = column (A = left), number = row (1 = top), so a 20x20 grid runs from A1 to T20.
// The size is the JSON's grid.size, so the cells you read here are the cells the bubbles use.

export const GridOverlay = ({n, w, h}: {n: number; w: number; h: number}) => {
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
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none"}}>
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
