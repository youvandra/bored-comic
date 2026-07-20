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
import { Arrow, Badge, BigTitle, Caption, ComicPanel, Halftone, SpeedLines, Terminal } from "./ui";

const Center: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", ...style }}>{children}</AbsoluteFill>
);

// ============================== 1. HOOK (8s) ==============================
export const SceneHook: React.FC = () => {
  const frame = useCurrentFrame();
  const swap = 92; // frame where line 2 takes over
  return (
    <AbsoluteFill>
      <Halftone />
      <SpeedLines opacity={interpolate(frame, [0, 30], [0, 0.14], { extrapolateRight: "clamp" })} />

      {/* floating panels behind */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 70, alignItems: "center", opacity: 0.92 }}>
          <ComicPanel src="ep1-panel-1-1.png" width={360} delay={26} rotate={-5} from="left" />
          <ComicPanel src="ep1-panel-2-2.png" width={430} delay={34} rotate={2} from="bottom" />
          <ComicPanel src="ep2-panel-1-0.png" width={360} delay={42} rotate={5} from="right" />
        </div>
      </AbsoluteFill>
      {/* dark veil for readability */}
      <AbsoluteFill style={{ background: "rgba(10,10,20,0.45)" }} />

      <Center>
        {frame < swap ? (
          <BigTitle size={130} delay={4}>
            YOUR AGENT
            <br />
            CAN&apos;T DRAW.
          </BigTitle>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
            <BigTitle size={140} color={C.yellow} delay={swap}>
              BOREDCOMIC CAN.
            </BigTitle>
            <BigTitle size={82} color={C.teal} delay={swap + 26}>
              — AND IT REMEMBERS.
            </BigTitle>
          </div>
        )}
      </Center>

      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 56 }}>
        <Caption delay={150} size={36} color={C.white}>
          A comic-generation MCP service on X Layer&nbsp;&nbsp;·&nbsp;&nbsp;Agent #6006
        </Caption>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ============================== 2. GENERATE (14s) ==============================
export const SceneGenerate: React.FC = () => {
  const frame = useCurrentFrame();
  const respAt = 175; // response lines appear
  return (
    <AbsoluteFill>
      <Halftone />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 48 }}>
        <BigTitle size={92} delay={0}>
          ONE CALL. <span style={{ color: C.yellow }}>COMPLETE COMIC.</span>
        </BigTitle>
        <Caption delay={16} size={33}>
          story · art · speech balloons · SFX · cover · PDF · CBZ — from a single prompt
        </Caption>
      </AbsoluteFill>

      <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", padding: "120px 90px 40px" }}>
        {/* terminal */}
        <div style={{ flex: 1.05, display: "flex", justifyContent: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Terminal
              delay={20}
              width={820}
              lines={[
                { text: "> tools/call generate_comic", color: C.teal },
                { text: '{' },
                { text: '  "prompt": "Mia the young inventor and her' },
                { text: '     clumsy robot Bob race to deliver a glowing' },
                { text: '     package across a futuristic city…",' },
                { text: '  "pages": 2, "genre": "action", "style": "manga",' },
                { text: '  "characterIds": ["ch_mrnhnch9e9d80ceb"],' },
                { text: '  "seriesId": "sr_mrnhnpj61c835a59"' },
                { text: '}' },
              ]}
            />
            {frame >= respAt ? (
              <Terminal
                delay={respAt}
                width={820}
                charsPerFrame={4}
                title="delivery — 65s later"
                lines={[
                  { text: '✓ "title": "Sunset Delivery"', color: C.green },
                  { text: '✓ 2 pages · 6 panels · cover · PDF · CBZ', color: C.green },
                  { text: '✓ per-panel images + accessibility alt text', color: C.green },
                  { text: '✓ vision QA 8.5/10 · $0.01 · honest counts', color: C.green },
                ]}
              />
            ) : null}
          </div>
        </div>

        {/* comic reveal */}
        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div style={{ position: "relative", height: 760, width: 760 }}>
            <div style={{ position: "absolute", left: 240, top: 30 }}>
              <ComicPanel src="ep1-page-1.png" width={330} delay={215} rotate={4} from="right" />
            </div>
            <div style={{ position: "absolute", left: 420, top: 90 }}>
              <ComicPanel src="ep1-page-2.png" width={330} delay={235} rotate={8} from="right" />
            </div>
            <div style={{ position: "absolute", left: 40, top: 0 }}>
              <ComicPanel src="ep1-cover.png" width={420} delay={190} rotate={-4} from="bottom" label="EPISODE 1 — SUNSET DELIVERY" />
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ============================== 3. CHARACTERS (14s) ==============================
export const SceneCharacters: React.FC = () => {
  return (
    <AbsoluteFill>
      <Halftone />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 48 }}>
        <BigTitle size={92}>
          REGISTER A CHARACTER <span style={{ color: C.yellow }}>ONCE.</span>
        </BigTitle>
        <Caption delay={14} size={33}>
          create_character → canonical look + a stable seed, stored forever
        </Caption>
      </AbsoluteFill>

      <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", padding: "150px 100px 40px" }}>
        <div style={{ flex: 0.95, display: "flex", flexDirection: "column", alignItems: "center", gap: 44 }}>
          <ComicPanel src="mia-reference.png" width={480} delay={20} rotate={-3} from="left" label="MIA — REFERENCE SHEET" />
          <div style={{ marginTop: 10 }}>
            <Badge delay={55} size={27} bg={C.teal}>
              seed 734452188 · reused in every job
            </Badge>
          </div>
        </div>

        <div style={{ flex: 0.28, display: "flex", justifyContent: "center" }}>
          <Arrow delay={80} length={150} />
        </div>

        <div style={{ flex: 1.3, display: "flex", flexDirection: "column", alignItems: "center", gap: 40 }}>
          <div style={{ display: "flex", gap: 44, alignItems: "flex-start" }}>
            <ComicPanel src="ep1-panel-1-1.png" width={280} delay={100} rotate={-3} from="bottom" label="EPISODE 1" />
            <ComicPanel src="ep1-panel-2-1.png" width={280} delay={120} rotate={2} from="bottom" label="REVISED PAGE" labelBg={C.teal} />
            <ComicPanel src="ep2-panel-2-2.png" width={280} delay={140} rotate={4} from="bottom" label="EPISODE 2" labelBg={C.red} />
          </div>
          <Caption delay={170} size={40} color={C.white}>
            Same Mia. Every comic. Every episode.
          </Caption>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ============================== 4. SERIES (14s) ==============================
export const SceneSeries: React.FC = () => {
  return (
    <AbsoluteFill>
      <Halftone />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 48 }}>
        <BigTitle size={92}>
          EVERY CALL <span style={{ color: C.yellow }}>CONTINUES THE STORY.</span>
        </BigTitle>
        <Caption delay={14} size={33}>
          create_series → each generate_comic becomes the next episode, with memory
        </Caption>
      </AbsoluteFill>

      <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 40, paddingTop: 130 }}>
        <ComicPanel src="ep1-cover.png" width={400} delay={20} rotate={-3} from="left" label="EP 1 — SUNSET DELIVERY" />

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, width: 460 }}>
          <Caption delay={60} size={27} color={C.dim} style={{ fontFamily: FONT_MONO, fontWeight: 400 }}>
            endingSummary — remembered by the series
          </Caption>
          <Caption delay={60} size={30} color={C.paper} style={{ fontStyle: "italic" }}>
            “…the package gently opens, revealing a small glowing seed that plants itself in the city&apos;s core.”
          </Caption>
          <Arrow delay={95} length={200} />
          <Caption delay={100} size={27} color={C.teal} style={{ fontFamily: FONT_MONO, fontWeight: 400 }}>
            next call, same seriesId ↓ writer continues from here
          </Caption>
        </div>

        <ComicPanel src="ep2-cover.png" width={400} delay={115} rotate={3} from="right" label="EP 2 — THE CORE AWAKENS" labelBg={C.red} />
      </AbsoluteFill>

      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 46 }}>
        <Caption delay={160} size={34} color={C.white}>
          Full episode history queryable via <span style={{ color: C.teal, fontFamily: FONT_MONO }}>get_series</span> — free
        </Caption>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ============================== 5. REVISE (12s) ==============================
export const SceneRevise: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // wipe reveal of "after" page
  const wipe = interpolate(frame, [130, 185], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const zoom = spring({ frame: frame - 200, fps, config: { damping: 16, stiffness: 60 } });
  return (
    <AbsoluteFill>
      <Halftone />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 48 }}>
        <BigTitle size={92}>
          FIX ONE PAGE. <span style={{ color: C.yellow }}>NOT THE WHOLE BOOK.</span>
        </BigTitle>
      </AbsoluteFill>

      <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", padding: "130px 110px 40px", gap: 70 }}>
        <div style={{ flex: 1.1 }}>
          <Terminal
            delay={16}
            width={800}
            charsPerFrame={3}
            lines={[
              { text: "> tools/call revise_page", color: C.teal },
              { text: '{' },
              { text: '  "jobId": "cg_1784205128835_dx0u57",' },
              { text: '  "page": 2,' },
              { text: '  "instruction": "make the final panel a dramatic' },
              { text: '     close-up of the package bursting open"' },
              { text: '}' },
            ]}
          />
          <div style={{ marginTop: 34, display: "flex", gap: 22 }}>
            <Badge delay={190} size={26}>
              base rate — 0.5 USDT
            </Badge>
            <Badge delay={205} size={26} bg={C.teal}>
              same seed · same cast · PDF + CBZ rebuilt
            </Badge>
          </div>
        </div>

        {/* before/after wipe */}
        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <div
            style={{
              position: "relative",
              width: 520,
              transform: `scale(${1 + zoom * 0.06})`,
            }}
          >
            <Img
              src={staticFile("revise-before.png")}
              style={{
                width: "100%",
                display: "block",
                border: `6px solid ${C.white}`,
                outline: `4px solid ${C.ink}`,
                borderRadius: 4,
                boxShadow: "14px 14px 0 rgba(0,0,0,0.45)",
              }}
            />
            <div style={{ position: "absolute", inset: 0, overflow: "hidden", clipPath: `inset(0 ${100 - wipe}% 0 0)` }}>
              <Img
                src={staticFile("revise-after2.png")}
                style={{ width: "100%", display: "block", border: `6px solid ${C.yellow}`, borderRadius: 4 }}
              />
            </div>
            {wipe > 2 && wipe < 99 ? (
              <div
                style={{
                  position: "absolute",
                  top: -10,
                  bottom: -10,
                  left: `${wipe}%`,
                  width: 10,
                  background: C.yellow,
                  border: `3px solid ${C.ink}`,
                }}
              />
            ) : null}
            <div style={{ position: "absolute", top: -58, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
              {wipe < 50 ? (
                <Badge size={26} bg="#c9d1e8">BEFORE</Badge>
              ) : (
                <Badge size={26}>AFTER — one call, one page</Badge>
              )}
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ============================== 6. TRUST + X402 (12s) ==============================
const Row: React.FC<{ k: string; v: string; delay: number; vColor?: string }> = ({ k, v, delay, vColor = C.green }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame - delay, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ display: "flex", gap: 14, opacity: o, fontFamily: FONT_MONO, fontSize: 24.5, lineHeight: 1.75 }}>
      <span style={{ color: C.dim, minWidth: 210 }}>{k}</span>
      <span style={{ color: vColor, whiteSpace: "pre-wrap" }}>{v}</span>
    </div>
  );
};

export const SceneTrust: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pay = spring({ frame: frame - 175, fps, config: { damping: 12, stiffness: 120 } });
  return (
    <AbsoluteFill>
      <Halftone />
      <AbsoluteFill style={{ flexDirection: "row", padding: "40px 90px", gap: 60, alignItems: "center" }}>
        {/* left: verifiable delivery */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 30 }}>
          <BigTitle size={68} delay={0} color={C.teal}>
            VERIFIABLE DELIVERY
          </BigTitle>
          <div
            style={{
              background: C.term,
              border: `4px solid ${C.ink}`,
              borderRadius: 14,
              boxShadow: "12px 12px 0 rgba(0,0,0,0.5)",
              padding: "26px 34px",
              width: 820,
            }}
          >
            <Row delay={25} k="integrity" v="sha256 of every file" />
            <Row delay={40} k="  cover.png" v="e7b4538f36b1f7d0…" vColor={C.dim} />
            <Row delay={50} k="  comic.pdf" v="396973146b09ac17…" vColor={C.dim} />
            <Row delay={65} k="receipt" v="HMAC-SHA256 — signed proof" />
            <Row delay={78} k="  signature" v="dff61e1833fc8ff5…" vColor={C.yellow} />
            <Row delay={95} k="license" v="commercial use + provenance" />
            <Row delay={110} k="vision QA" v="every page graded — 8.5/10 avg" />
            <Row delay={125} k="honesty" v="counts = rendered, not claimed" />
          </div>
        </div>

        {/* right: x402 */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 30 }}>
          <BigTitle size={68} delay={140} color={C.yellow}>
            PAID PER CALL — x402
          </BigTitle>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, transform: `scale(${Math.min(1, pay * 1.3)})`, opacity: Math.min(1, pay * 1.5) }}>
            <Badge size={30} bg="#c9d1e8">paid tool call → HTTP 402</Badge>
            <Arrow delay={195} length={60} vertical />
            <Badge size={30} bg={C.teal}>settled on-chain in USDT0 · X Layer</Badge>
            <Arrow delay={225} length={60} vertical />
            <Badge size={30}>HTTP 200 — comic delivered</Badge>
          </div>
          <Caption delay={255} size={33} color={C.white} style={{ maxWidth: 700 }}>
            OKX facilitator settles payment. The server holds <span style={{ color: C.red }}>no private key</span> and pays{" "}
            <span style={{ color: C.red }}>no gas</span>. Bad input is rejected <i>before</i> payment.
          </Caption>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ============================== 7. OUTRO (11s) ==============================
export const SceneOutro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 14, stiffness: 90 } });
  return (
    <AbsoluteFill>
      <Halftone />
      {/* dimmed cover collage */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: 0.3 }}>
        <div style={{ display: "flex", gap: 60, transform: "rotate(-3deg) scale(1.15)" }}>
          <Img src={staticFile("ep1-cover.png")} style={{ width: 500, borderRadius: 6 }} />
          <Img src={staticFile("mia-reference.png")} style={{ width: 500, borderRadius: 6, alignSelf: "center" }} />
          <Img src={staticFile("ep2-cover.png")} style={{ width: 500, borderRadius: 6 }} />
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "rgba(10,10,20,0.55)" }} />

      <Center>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 30, transform: `scale(${s})` }}>
          <BigTitle size={200} color={C.yellow}>
            BOREDCOMIC
          </BigTitle>
          <BigTitle size={74} color={C.white} delay={22}>
            YOUR STORY, DRAWN.
          </BigTitle>
          <div style={{ marginTop: 26, display: "flex", gap: 26 }}>
            <Badge delay={55} size={31} bg={C.teal}>Agent #6006</Badge>
            <Badge delay={68} size={31}>boredcomic.web.id/mcp</Badge>
          </div>
          <div style={{ marginTop: 34, display: "flex", alignItems: "center", gap: 20 }}>
            <Caption delay={95} size={35} color={C.white}>
              Built for the OKX.AI Genesis Hackathon
            </Caption>
            <Img src={staticFile("okx-logo.png")} style={{ height: 44, opacity: interpolate(frame, [95, 110], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }} />
          </div>
        </div>
      </Center>
    </AbsoluteFill>
  );
};
