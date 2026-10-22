// src/Root.tsx
// NOT NEW: existing file, changed (new composition "ComicEdit" that is driven by the JSON)

import {Composition, staticFile} from "remotion";
import {getVideoMetadata} from "@remotion/media-utils";
import {DanceEdit2, VIDEO2} from "./DanceEdit2";
import {NatashaEdit, VIDEO3} from "./NatashaEdit";
import {NatashaBubble} from "./NatashaBubble";
import {NatashaComic} from "./NatashaComic";
import {ComicEdit} from "./ComicEdit";
import {validateAgainstVideo, validateSpec, type Spec} from "./spec";

const FPS = 30;
const DANCE2_MIN_SECONDS = 25; // DanceEdit2 ends with the scramble at ~24.1s, so the video is at least this long

export const Root = () => {
  console.log("[Root] registering compositions: DanceEdit2, NatashaEdit");
  return (
    <>
      <Composition
        id="DanceEdit2"
        component={DanceEdit2}
        durationInFrames={90}
        fps={FPS}
        width={1080}
        height={1920}
        calculateMetadata={async () => {
          // Size comes from the video; length = video or the scramble ending, whichever is longer
          const m = await getVideoMetadata(staticFile(VIDEO2));
          const total = Math.max(m.durationInSeconds, DANCE2_MIN_SECONDS);
          console.log(`[Root] ${VIDEO2}: ${m.width}x${m.height}, video ${m.durationInSeconds.toFixed(3)}s, total ${total}s`);
          return {durationInFrames: Math.ceil(total * FPS), width: m.width, height: m.height};
        }}
      />
      <Composition
        id="NatashaEdit"
        component={NatashaEdit}
        durationInFrames={90}
        fps={FPS}
        width={1080}
        height={1920}
        calculateMetadata={async () => {
          const m = await getVideoMetadata(staticFile(VIDEO3));
          console.log(`[Root] ${VIDEO3}: ${m.width}x${m.height}, ${m.durationInSeconds.toFixed(3)}s`);
          return {durationInFrames: Math.ceil(m.durationInSeconds * FPS), width: m.width, height: m.height};
        }}
      />
      <Composition
        id="NatashaBubble"
        component={NatashaBubble}
        durationInFrames={90}
        fps={FPS}
        width={1080}
        height={1920}
        calculateMetadata={async () => {
          const m = await getVideoMetadata(staticFile(VIDEO3));
          console.log(`[Root] bubble test on ${VIDEO3}: ${m.width}x${m.height}, ${m.durationInSeconds.toFixed(3)}s`);
          return {durationInFrames: Math.ceil(m.durationInSeconds * FPS), width: m.width, height: m.height};
        }}
      />
      <Composition
        id="NatashaComic"
        component={NatashaComic}
        durationInFrames={90}
        fps={FPS}
        width={1080}
        height={1920}
        calculateMetadata={async () => {
          const m = await getVideoMetadata(staticFile(VIDEO3));
          console.log(`[Root] comic test on ${VIDEO3}: ${m.width}x${m.height}, ${m.durationInSeconds.toFixed(3)}s`);
          return {durationInFrames: Math.ceil(m.durationInSeconds * FPS), width: m.width, height: m.height};
        }}
      />
      <Composition
        id="ComicEdit"
        component={ComicEdit}
        durationInFrames={90}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{} as Spec}
        calculateMetadata={async ({props}) => {
          // the props ARE the JSON: check it first, stop with every problem listed
          const {errors, warnings} = validateSpec(props);
          if (errors.length) throw new Error(`The JSON has ${errors.length} problem(s):\n- ${errors.join("\n- ")}`);
          warnings.forEach((w) => console.warn(`[Root] warning: ${w}`));
          const m = await getVideoMetadata(staticFile(props.video.file));
          const late = validateAgainstVideo(props, m.durationInSeconds);
          if (late.length) throw new Error(`The JSON does not fit the video:\n- ${late.join("\n- ")}`);
          console.log(`[Root] ComicEdit ${props.video.file}: ${m.width}x${m.height}, ${m.durationInSeconds.toFixed(3)}s, ${props.captions.length} captions`);
          return {durationInFrames: Math.ceil(m.durationInSeconds * props.fps), fps: props.fps, width: m.width, height: m.height};
        }}
      />
    </>
  );
};