import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C, FONT_BODY, FONT_MONO, FONT_TITLE } from "./theme";

// ---------- background ----------
export const Halftone: React.FC<{ tint?: string }> = ({ tint = C.bg }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse at 50% 35%, ${C.bg2} 0%, ${tint} 70%)`,
    }}
  >
    <AbsoluteFill
      style={{
        backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.05) 1.6px, transparent 1.6px)`,
        backgroundSize: "26px 26px",
      }}
    />
  </AbsoluteFill>
);

export const SpeedLines: React.FC<{ opacity?: number }> = ({ opacity = 0.12 }) => {
  const lines = Array.from({ length: 28 });
  return (
    <AbsoluteFill style={{ opacity }}>
      <svg width="100%" height="100%" viewBox="0 0 1920 1080">
        {lines.map((_, i) => {
          const a = (i / lines.length) * Math.PI * 2;
          const x = 960 + Math.cos(a) * 2200;
          const y = 540 + Math.sin(a) * 2200;
          return (
            <line
              key={i}
              x1={960 + Math.cos(a) * 420}
              y1={540 + Math.sin(a) * 300}
              x2={x}
              y2={y}
              stroke="white"
              strokeWidth={i % 3 === 0 ? 5 : 2}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

// ---------- typography ----------
export const BigTitle: React.FC<{
  children: React.ReactNode;
  color?: string;
  size?: number;
  delay?: number;
  style?: React.CSSProperties;
}> = ({ children, color = C.white, size = 110, delay = 0, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 12, stiffness: 160 } });
  return (
    <div
      style={{
        fontFamily: FONT_TITLE,
        fontSize: size,
        color,
        letterSpacing: 3,
        textAlign: "center",
        lineHeight: 1.02,
        transform: `scale(${s}) rotate(${interpolate(s, [0, 1], [-4, -1])}deg)`,
        opacity: Math.min(1, s * 1.4),
        WebkitTextStroke: `${Math.max(2, size / 26)}px ${C.ink}`,
        textShadow: `${size / 16}px ${size / 14}px 0 rgba(0,0,0,0.55)`,
        paintOrder: "stroke fill",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Caption: React.FC<{
  children: React.ReactNode;
  delay?: number;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}> = ({ children, delay = 0, size = 34, color = C.dim, style }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame - delay, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(frame - delay, [0, 12], [16, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        fontFamily: FONT_BODY,
        fontWeight: 700,
        fontSize: size,
        color,
        textAlign: "center",
        opacity: o,
        transform: `translateY(${y}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Badge: React.FC<{
  children: React.ReactNode;
  color?: string;
  bg?: string;
  delay?: number;
  size?: number;
}> = ({ children, color = C.ink, bg = C.yellow, delay = 0, size = 30 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 11, stiffness: 200 } });
  return (
    <div
      style={{
        display: "inline-block",
        fontFamily: FONT_TITLE,
        fontSize: size,
        letterSpacing: 2,
        color,
        background: bg,
        border: `4px solid ${C.ink}`,
        borderRadius: 12,
        padding: "8px 26px",
        boxShadow: "6px 6px 0 rgba(0,0,0,0.5)",
        transform: `scale(${s}) rotate(-2deg)`,
      }}
    >
      {children}
    </div>
  );
};

// ---------- comic image panel ----------
export const ComicPanel: React.FC<{
  src: string;
  width: number;
  delay?: number;
  rotate?: number;
  label?: string;
  labelBg?: string;
  from?: "left" | "right" | "bottom" | "pop";
  style?: React.CSSProperties;
}> = ({ src, width, delay = 0, rotate = 0, label, labelBg = C.yellow, from = "pop", style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 13, stiffness: 130 } });
  let transform = `scale(${s}) rotate(${rotate}deg)`;
  if (from === "left") transform = `translateX(${interpolate(s, [0, 1], [-600, 0])}px) rotate(${rotate}deg)`;
  if (from === "right") transform = `translateX(${interpolate(s, [0, 1], [600, 0])}px) rotate(${rotate}deg)`;
  if (from === "bottom") transform = `translateY(${interpolate(s, [0, 1], [500, 0])}px) rotate(${rotate}deg)`;
  return (
    <div style={{ position: "relative", transform, opacity: Math.min(1, s * 1.5), ...style }}>
      <Img
        src={staticFile(src)}
        style={{
          width,
          display: "block",
          border: `6px solid ${C.white}`,
          outline: `4px solid ${C.ink}`,
          borderRadius: 4,
          boxShadow: "14px 14px 0 rgba(0,0,0,0.45)",
        }}
      />
      {label ? (
        <div
          style={{
            position: "absolute",
            bottom: -24,
            left: "50%",
            transform: "translateX(-50%) rotate(-2deg)",
            whiteSpace: "nowrap",
            fontFamily: FONT_TITLE,
            fontSize: 30,
            letterSpacing: 1.5,
            color: C.ink,
            background: labelBg,
            border: `4px solid ${C.ink}`,
            borderRadius: 10,
            padding: "4px 18px",
            boxShadow: "5px 5px 0 rgba(0,0,0,0.5)",
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
};

// ---------- terminal ----------
export const Terminal: React.FC<{
  lines: { text: string; color?: string; typed?: boolean }[];
  delay?: number;
  charsPerFrame?: number;
  width?: number;
  fontSize?: number;
  title?: string;
}> = ({ lines, delay = 0, charsPerFrame = 2.2, width = 780, fontSize = 25, title = "agent — mcp client" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 140 } });
  let budget = Math.max(0, (frame - delay - 8) * charsPerFrame);
  return (
    <div
      style={{
        width,
        background: C.term,
        border: `4px solid ${C.ink}`,
        borderRadius: 14,
        boxShadow: "12px 12px 0 rgba(0,0,0,0.5)",
        overflow: "hidden",
        transform: `scale(${s})`,
        opacity: Math.min(1, s * 1.4),
      }}
    >
      <div
        style={{
          background: "#1a1f38",
          padding: "10px 18px",
          display: "flex",
          alignItems: "center",
          gap: 9,
        }}
      >
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <div key={c} style={{ width: 15, height: 15, borderRadius: 8, background: c }} />
        ))}
        <span style={{ fontFamily: FONT_MONO, color: C.dim, fontSize: 19, marginLeft: 10 }}>{title}</span>
      </div>
      <div style={{ padding: "18px 24px", minHeight: 60 }}>
        {lines.map((l, i) => {
          let shown = l.text;
          if (l.typed !== false) {
            if (budget <= 0) return null;
            shown = l.text.slice(0, Math.floor(budget));
            budget -= l.text.length;
          }
          return (
            <div
              key={i}
              style={{
                fontFamily: FONT_MONO,
                fontSize,
                lineHeight: 1.5,
                color: l.color ?? "#d8e0ff",
                whiteSpace: "pre-wrap",
              }}
            >
              {shown}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// arrow connector
export const Arrow: React.FC<{ delay?: number; length?: number; color?: string; vertical?: boolean }> = ({
  delay = 0,
  length = 120,
  color = C.yellow,
  vertical = false,
}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame - delay, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const w = vertical ? 16 : length * p;
  const h = vertical ? length * p : 16;
  return (
    <div style={{ display: "flex", alignItems: "center", flexDirection: vertical ? "column" : "row" }}>
      <div style={{ width: w, height: h, background: color, border: `3px solid ${C.ink}`, borderRadius: 6 }} />
      {p > 0.9 ? (
        <div
          style={{
            width: 0,
            height: 0,
            borderTop: `${vertical ? 26 : 20}px solid ${vertical ? color : "transparent"}`,
            borderLeft: `${vertical ? 20 : 26}px solid ${vertical ? "transparent" : color}`,
            borderBottom: `${vertical ? 0 : 20}px solid transparent`,
            borderRight: vertical ? "20px solid transparent" : undefined,
          }}
        />
      ) : null}
    </div>
  );
};
