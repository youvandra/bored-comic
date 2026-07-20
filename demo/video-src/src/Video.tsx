import React from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFonts } from "./theme";
import {
  SceneCharacters,
  SceneGenerate,
  SceneHook,
  SceneOutro,
  SceneRevise,
  SceneSeries,
  SceneTrust,
} from "./scenes";

loadFonts();

// scene lengths in frames @30fps — total 2550 (85s)
export const TIMELINE = [
  { name: "hook", from: 0, dur: 240 },
  { name: "generate", from: 240, dur: 420 },
  { name: "characters", from: 660, dur: 420 },
  { name: "series", from: 1080, dur: 420 },
  { name: "revise", from: 1500, dur: 360 },
  { name: "trust", from: 1860, dur: 360 },
  { name: "outro", from: 2220, dur: 330 },
];

// quick crossfade wrapper: fades a scene in over its first 10 frames
const Fade: React.FC<{ children: React.ReactNode; dur: number }> = ({ children, dur }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10, dur - 8, dur], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export const Video: React.FC = () => {
  const { durationInFrames } = useVideoConfig();
  const scenes = [SceneHook, SceneGenerate, SceneCharacters, SceneSeries, SceneRevise, SceneTrust, SceneOutro];
  return (
    <AbsoluteFill style={{ background: "#0c0e1d" }}>
      {TIMELINE.map((t, i) => {
        const S = scenes[i];
        return (
          <Sequence key={t.name} from={t.from} durationInFrames={t.dur}>
            <Fade dur={t.dur}>
              <S />
            </Fade>
          </Sequence>
        );
      })}
      <Audio
        src={staticFile("music.wav")}
        volume={(f) =>
          interpolate(f, [0, 30, durationInFrames - 90, durationInFrames - 10], [0, 0.4, 0.4, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        }
      />
    </AbsoluteFill>
  );
};
