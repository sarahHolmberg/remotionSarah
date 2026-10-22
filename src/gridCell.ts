// Turns a cell name like "H8" into pixels. Same naming as grid-player.html:
// letter = column (A = left), number = row (1 = top).
export const cellRect = (name: string, width: number, height: number, n = 15) => {
  const col = name.charCodeAt(0) - 65;
  const row = parseInt(name.slice(1), 10) - 1;
  const cw = width / n;
  const ch = height / n;
  const rect = {x: col * cw, y: row * ch, w: cw, h: ch, cx: col * cw + cw / 2, cy: row * ch + ch / 2};
  console.log(`[cellRect] ${name} -> col ${col}, row ${row}`, rect);
  return rect;
};

// Usage: const {cx, cy} = cellRect("H8", 1080, 1920); // center of H8 in pixels

