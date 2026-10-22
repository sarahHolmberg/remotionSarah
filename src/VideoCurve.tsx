import {AbsoluteFill, Easing, interpolate, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {cellRect} from "./gridCell";

// ---- Edit these ----
export const VIDEO = "video.mp4"; // file in /public
const GRID = 9; // 9x9 grid
const FROM = "H3";
const TO = "G4";
const T_START = 0.18; // seconds: line starts
const T_END = 0.92; // seconds: line ends
const ZOOM = 1.08; // subtle zoom reached by T_END
const BEND = 0.6; // how curved the line is (0 = straight)
const COLOR = "#ffd400";
// --------------------

export const VideoCurve = () => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();

  const a = cellRect(FROM, width, height, GRID);
  const b = cellRect(TO, width, height, GRID);
  const [x0, y0, x1, y1] = [a.cx, a.cy, b.cx, b.cy];

  // Control point = midpoint pushed sideways -> smooth quadratic curve
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const cx = mx - (y1 - y0) * BEND;
  const cy = my + (x1 - x0) * BEND;

  const f0 = T_START * fps;
  const f1 = T_END * fps;
  if (frame === Math.round(f0)) console.log(`[VideoCurve] line starts: ${FROM} -> ${TO} at ${T_START}s (frame ${frame})`);
  if (frame === Math.round(f1)) console.log(`[VideoCurve] line ends at ${T_END}s (frame ${frame})`);

  const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;
  const draw = interpolate(frame, [f0, f1], [0, 1], {...clamp, easing: Easing.inOut(Easing.cubic)});
  const fade = interpolate(frame, [f0, f0 + 4], [0, 1], clamp); // soft appearance
  const zoom = interpolate(frame, [f0, f1], [1, ZOOM], {...clamp, easing: Easing.inOut(Easing.cubic)});

  // Pen tip position on the quadratic Bezier
  const u = 1 - draw;
  const tx = u * u * x0 + 2 * u * draw * cx + draw * draw * x1;
  const ty = u * u * y0 + 2 * u * draw * cy + draw * draw * y1;

  const lw = width * 0.008;

  return (
    <AbsoluteFill style={{background: "black"}}>
      {/* video + line zoom together, centered on the line */}
      <AbsoluteFill style={{transform: `scale(${zoom})`, transformOrigin: `${mx}px ${my}px`}}>
        <OffthreadVideo src={staticFile(VIDEO)} style={{width, height}} />
        <svg width={width} height={height} style={{position: "absolute", inset: 0}}>
          <path
            d={`M ${x0} ${y0} Q ${cx} ${cy} ${x1} ${y1}`}
            fill="none"
            stroke={COLOR}
            strokeWidth={lw}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={`${draw} 2`}
            opacity={fade}
            style={{filter: `drop-shadow(0 0 ${lw}px ${COLOR})`}}
          />
          <circle cx={tx} cy={ty} r={lw * 1.1} fill="white" opacity={fade * (draw > 0 && draw < 1 ? 1 : 0)} />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};