import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from "remotion";
import {loadFont} from "@remotion/google-fonts/Poppins";

const {fontFamily} = loadFont("normal", {weights: ["800"]});

const WORDS = ["HELLO", "WORLD!"];
const STAGGER = 12; // frames between each word pop

export const HelloWorld = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  if (frame === 0) console.log(`[HelloWorld] start | fps=${fps} frames=${durationInFrames}`);

  // Background hue slowly shifts for a lively gradient
  const hue = interpolate(frame, [0, durationInFrames], [320, 380]);

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, hsl(${hue}, 90%, 55%), hsl(${hue + 60}, 90%, 50%))`,
        justifyContent: "center",
        alignItems: "center",
        fontFamily,
      }}
    >
      {WORDS.map((word, i) => {
        const delay = i * STAGGER;
        if (frame === delay) console.log(`[HelloWorld] pop "${word}" at frame ${frame}`);

        // Bouncy spring = the "Instagram pop" feel
        const scale = spring({frame: frame - delay, fps, config: {damping: 8, stiffness: 120}});
        const rotate = interpolate(scale, [0, 1], [-12, i % 2 === 0 ? -3 : 3]);

        return (
          <div
            key={word}
            style={{
              fontSize: 200,
              fontWeight: 800,
              color: "white",
              textShadow: "0 12px 0 rgba(0,0,0,0.25)",
              transform: `scale(${scale}) rotate(${rotate}deg)`,
            }}
          >
            {word}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
