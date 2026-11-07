// src/MascotLayer.tsx
// NEW FILE: the "Mascot" bubble style (JSON bubble3d.engine = "mascot"): the Mirrors mascot instead of the bubbles.
// All of his look, animations and choreography are in src/mascot/mascot.js (shared with the playground); this file only
// puts him in a Three.js layer over the video and tells him the time. Settings: DEFAULTS merged with JSON "mascot".

import {useEffect, useMemo} from "react";
import * as THREE from "three";
import {ThreeCanvas} from "@remotion/three";
import {createMascot, DEFAULTS, type MascotMove, type MascotSettings} from "./mascot/mascot";

type Props = {moves: MascotMove[]; settings?: MascotSettings; width: number; height: number; grid: number; t: number};

export const MascotLayer = ({moves, settings, width, height, grid, t}: Props) => {
  const key = JSON.stringify(settings ?? {});
  const mascot = useMemo(() => {
    const m = createMascot(THREE, {...DEFAULTS, ...settings});
    m.setSize(width, height, grid);
    return m;
  }, [key, width, height, grid]);
  useMemo(() => mascot.setMoves(moves), [mascot, moves]);
  useEffect(() => void document.fonts?.ready.then(() => mascot.refreshText()), [mascot]); // redraw the sign once the comic font is there
  mascot.frame(t); // pose him for this frame before the canvas draws it (he depends only on t, so every render frame is exact)
  return (
    <ThreeCanvas width={width} height={height} orthographic flat camera={{position: [0, 0, 3000], near: 1, far: 10000, zoom: 1}} gl={{antialias: true, alpha: true}} style={{position: "absolute", inset: 0}}>
      {/* the mascot works in pixels from the top left; the camera's centre is the middle of the frame */}
      <primitive object={mascot.world} position={[-width / 2, height / 2, 0]} />
    </ThreeCanvas>
  );
};
