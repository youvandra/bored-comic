import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { config } from "./config.js";
import type { Character, ComicDelivery, ComicEvidence, GenerateComicInput, PageResult, PanelLayout, PanelDescription, Storyboard } from "./types.js";
import { pickLayout } from "./types.js";
import { generateStoryboard } from "./writer.js";
import { generatePanel, type ImageGenResult } from "./illustrator.js";
import { buildPdf } from "./assembler.js";

export interface PipelineHooks {
  setStatus(status: string): void;
}

const GUTTER = 14;
const FRAME_STROKE = 4; // black ink border around each panel

// Page dimensions per aspect ratio. Base width ~800px, height derived.
function pageDims(aspectRatio?: string): { width: number; height: number } {
  switch (aspectRatio) {
    case "9:16":
      return { width: 800, height: 1422 };
    case "1:1":
      return { width: 900, height: 900 };
    case "3:4":
    default:
      return { width: 800, height: 1067 };
  }
}

export async function runPipeline(
  jobId: string,
  input: GenerateComicInput,
  hooks: PipelineHooks,
): Promise<ComicDelivery> {
  const workDir = join(config.comicDir, jobId);
  await mkdir(workDir, { recursive: true });
  const startTime = Date.now();
  const lang = input.language || "en";
  const colorMode = input.colorMode || "color";
  const { width: pageW, height: pageH } = pageDims(input.aspectRatio);
  // One seed per job so panels share a coherent visual baseline.
  const jobSeed = Math.floor(Math.random() * 1_000_000_000);

  hooks.setStatus("writing");
  const storyboard = await generateStoryboard(input);

  hooks.setStatus("illustrating");
  const pageLayouts: PanelLayout[][] = [];

  const pageTasks = storyboard.pages.map(async (page, pageIdx) => {
    const firstCam = page.panelDescriptions[0]?.cameraAngle;
    const prevLayoutObj = pageLayouts[pageIdx - 1] ?? null;
    const layouts = pickLayout(page.panelDescriptions.length, prevLayoutObj, firstCam);
    pageLayouts.push(layouts);
    const panelImages: ImageGenResult[] = [];

    for (let i = 0; i < page.panelDescriptions.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1500));
      const pd = page.panelDescriptions[i]!;
      const prompt = buildPanelPrompt(pd, storyboard.characters, input.style || "manga", colorMode);

      const img = await generatePanel({ prompt, seed: jobSeed, pageNumber: page.page, panelIndex: i, workDir, jobId });
      panelImages.push(img);
    }

    await assemblePage({ panels: panelImages, layouts, pageNumber: page.page, workDir, dialogue: page.panelDescriptions.map((pd) => pd.dialogue), storyBeat: page.storyBeat, colorMode, pageW, pageH });

    // Report the panels actually rendered, not the LLM's declared count.
    const renderedPanels = page.panelDescriptions.length;
    return {
      page: page.page,
      panels: renderedPanels,
      storyBeat: page.storyBeat,
      imageUrl: `/comics/${jobId}/page-${page.page}.png`,
      evidence: {
        model: "@cf/black-forest-labs/flux-1-schnell",
        promptChars: panelImages.reduce((s, p) => s + p.promptChars, 0),
        characterCount: page.panelDescriptions.reduce((s, pd) => Math.max(s, pd.characters.length), 0),
        layout: `${layouts.length}p`,
        caveat: "Generated from text prompt — character appearance may vary slightly across pages.",
      },
    };
  });

  const pageResults = await Promise.all(pageTasks);

  hooks.setStatus("assembling");
  const pdfUrl = await buildPdf(pageResults, workDir, jobId);

  const elapsedSec = Math.round((Date.now() - startTime) / 1000);

  // Honest counts: derived from what was actually generated.
  const actualPages = pageResults.length;
  const totalPanels = pageResults.reduce((s, p) => s + p.panels, 0);

  const summary = `${actualPages}-page ${input.genre || "story"} ${input.style || "manga"} '${storyboard.title}': ${totalPanels} panels, ${storyboard.characters.length} characters. Generated in ${elapsedSec}s. Language: ${lang}. Color mode: ${colorMode}.`;

  return {
    jobId,
    summary,
    title: storyboard.title,
    pages: actualPages,
    totalPanels,
    style: input.style || "manga",
    genre: input.genre || "slice-of-life",
    language: lang,
    colorMode,
    characters: storyboard.characters,
    pageUrls: pageResults.map((p) => p.imageUrl),
    pdfUrl,
    perPage: pageResults,
    evidence: {
      model: "@cf/black-forest-labs/flux-1-schnell",
      pagesGenerated: actualPages,
      panelsGenerated: totalPanels,
      generationTimeSec: elapsedSec,
      costEstimateUsd: estimateCost(actualPages, totalPanels),
      language: lang,
      colorMode,
      caveat: "Comic is AI-generated. Story coherence and visual consistency are heuristic, not guaranteed.",
    },
  };
}

export function buildPanelPrompt(
  pd: PanelDescription,
  characters: Character[],
  style: string,
  colorMode: string,
): string {
  const charRefs = pd.characters
    .map((name) => {
      const c = characters.find((ch) => ch.name === name);
      return c ? `${c.name}: ${c.appearance}` : name;
    })
    .join("; ");

  const qualityTags = "professional comic book illustration, highly detailed, sharp focus, cinematic composition, clean bold linework, strong readable silhouette, clear focal subject, dramatic lighting";
  const styleTag = style === "manga" ? "manga style, screentone textures, expressive line art, dynamic angles"
    : style === "western" ? "western comic style, bold inks, flat colors, confident lines"
    : style === "semi-realistic" ? "semi-realistic, detailed shading, textured, painterly"
    : "chibi style, cute proportions, large eyes, soft rendering";

  const bwTag = colorMode === "bw"
    ? ", grayscale, high contrast, ink wash, no colors"
    : ", vibrant colors, rich palette, color harmony";

  // Speech and narration are overlaid separately, so keep the art free of any
  // baked-in lettering — FLUX otherwise renders garbled text that can't be read.
  const noTextTag = " Absolutely no text, no speech bubbles, no captions, no letters, no watermark, no signature in the image.";

  return `${qualityTags}, ${styleTag}${bwTag}. ${pd.scene}. ${charRefs}.${pd.cameraAngle ? ` Camera angle: ${pd.cameraAngle}.` : " Dynamic angle."} Single comic panel, consistent character designs.${noTextTag}`;
}

async function assemblePage(params: {
  panels: ImageGenResult[];
  layouts: PanelLayout[];
  pageNumber: number;
  workDir: string;
  dialogue: (string | undefined)[];
  storyBeat: string;
  colorMode: string;
  pageW: number;
  pageH: number;
}): Promise<string> {
  const { panels, layouts, pageNumber, workDir, dialogue, storyBeat, colorMode, pageW, pageH } = params;
  if (panels.length === 0) return "";

  const composite: { input: string | Buffer; top: number; left: number }[] = [];
  const frames: { x: number; y: number; w: number; h: number }[] = [];

  // Panels first (bottom layer), then frames, then narration on top.
  for (let i = 0; i < panels.length; i++) {
    const layout = layouts.find((l) => l.panelIndex === i) || layouts[i % layouts.length]!;
    const pw = Math.round((pageW - GUTTER) * layout.w - GUTTER);
    const ph = Math.round((pageH - GUTTER) * layout.h - GUTTER);

    const pngBuf = await sharp(panels[i].path)
      // "attention" keeps the salient subject (faces/action) in frame instead of
      // blindly cropping to centre.
      .resize(pw, ph, { fit: "cover", position: sharp.strategy.attention })
      .png()
      .toBuffer();

    const diag = dialogue[i];
    const buf = diag ? await addSpeechBubble(pngBuf, diag) : pngBuf;

    const x = Math.round(GUTTER + (pageW - GUTTER) * layout.x);
    const y = Math.round(GUTTER + (pageH - GUTTER) * layout.y);

    composite.push({ input: buf as Buffer, top: y, left: x });
    frames.push({ x, y, w: pw, h: ph });
  }

  // Black ink frames around every panel — the single biggest "reads like a comic" cue.
  composite.push({ input: renderFrames(frames, pageW, pageH), top: 0, left: 0 });

  // Narration caption box, drawn last so it sits above the art.
  if (storyBeat) {
    composite.push({ input: renderNarration(storyBeat, pageW, pageH), top: 0, left: 0 });
  }

  const outputPath = join(workDir, `page-${pageNumber}.png`);
  let pipeline = sharp({
    create: {
      width: pageW,
      height: pageH,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite(composite);

  if (colorMode === "bw") {
    pipeline = pipeline.grayscale();
  }

  await pipeline.png().toFile(outputPath);
  return outputPath;
}

// Word-wrap into at most maxLines lines. If it overflows, the last line ends
// with an ellipsis at a word boundary — never mid-word.
function wrapText(text: string, maxPerLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length > maxPerLine && cur) {
      lines.push(cur);
      cur = word;
      if (lines.length >= maxLines) break;
    } else {
      cur = next;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);

  const usedWords = lines.join(" ").split(/\s+/).filter(Boolean).length;
  if (usedWords < words.length && lines.length > 0) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/[.,;:!?]*$/, "") + "…";
  }
  return lines;
}

// Black ink frames around every panel.
function renderFrames(frames: { x: number; y: number; w: number; h: number }[], pageW: number, pageH: number): Buffer {
  const rects = frames
    .map((f) => `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" fill="none" stroke="#000000" stroke-width="${FRAME_STROKE}"/>`)
    .join("");
  return Buffer.from(`<svg width="${pageW}" height="${pageH}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`);
}

// Classic cream narration caption box, top-left corner, wrapped (no truncation).
function renderNarration(text: string, pageW: number, pageH: number): Buffer {
  const primary = text.split(";").map((s) => s.trim()).filter(Boolean)[0] || text;
  const boxW = Math.round(pageW * 0.62);
  const padX = 14;
  const padY = 10;
  const fontSize = 15;
  const lineH = 21;
  const maxPerLine = Math.max(12, Math.floor((boxW - padX * 2) / (fontSize * 0.5)));
  const lines = wrapText(primary, maxPerLine, 3);
  const boxH = lines.length * lineH + padY * 2;
  const x = GUTTER;
  const y = GUTTER;

  const tspans = lines
    .map((l, i) => `<tspan x="${x + padX}" dy="${i === 0 ? 0 : lineH}">${escapeXml(l)}</tspan>`)
    .join("");

  const svg = `<svg width="${pageW}" height="${pageH}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="2" ry="2"
            fill="#f5e9c8" stroke="#000000" stroke-width="2.5"/>
      <text x="${x + padX}" y="${y + padY + fontSize - 3}" font-family="Georgia, 'Times New Roman', serif"
            font-size="${fontSize}" font-style="italic" fill="#1a1a1a">${tspans}</text>
    </svg>`;

  return Buffer.from(svg);
}

// Opaque comic speech balloon near the top of the panel, all-caps lettering
// (comic convention), with a tail pointing down toward the speaker.
async function addSpeechBubble(imageBuf: Buffer, text: string): Promise<Buffer> {
  const meta = await sharp(imageBuf).metadata();
  const w = meta.width || 300;
  const h = meta.height || 300;

  const content = text.toUpperCase();
  const fontSize = Math.max(13, Math.min(20, Math.round(w / 22)));
  const lineH = Math.round(fontSize * 1.35);
  const avgCharW = fontSize * 0.62;
  const maxPerLine = Math.max(8, Math.floor((w * 0.82) / avgCharW));
  const maxLines = h < 200 ? 2 : h < 340 ? 3 : 4;
  const lines = wrapText(content, maxPerLine, maxLines);

  const longest = Math.max(...lines.map((l) => l.length));
  const bubbleW = Math.min(w - 16, Math.round(longest * avgCharW + fontSize * 1.8));
  const bubbleH = lines.length * lineH + Math.round(fontSize * 1.1);
  const bx = Math.round((w - bubbleW) / 2);
  const by = 10;
  const cx = w / 2;
  const tailBase = by + bubbleH;

  const textStartY = by + Math.round((bubbleH - (lines.length - 1) * lineH) / 2) + Math.round(fontSize * 0.35);
  const tspans = lines
    .map((l, i) => `<tspan x="${cx}" dy="${i === 0 ? 0 : lineH}">${escapeXml(l)}</tspan>`)
    .join("");

  // Tail first (behind), balloon on top so the balloon border hides the seam.
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <polygon points="${cx - 11},${tailBase - 6} ${cx + 11},${tailBase - 6} ${cx - 2},${tailBase + 16}"
               fill="#ffffff" stroke="#000000" stroke-width="2.5" stroke-linejoin="round"/>
      <rect x="${bx}" y="${by}" width="${bubbleW}" height="${bubbleH}" rx="${Math.round(bubbleH / 2.6)}" ry="${Math.round(bubbleH / 2.6)}"
            fill="#ffffff" stroke="#000000" stroke-width="2.5"/>
      <text x="${cx}" y="${textStartY}" font-family="'Arial Black', 'Helvetica Neue', Helvetica, sans-serif"
            font-size="${fontSize}" font-weight="900" fill="#000000" text-anchor="middle">${tspans}</text>
    </svg>`;

  return sharp(imageBuf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function estimateCost(pages: number, panels: number): number {
  const llmCost = 0.005;
  const imageCostPerPanel = 0.001;
  const total = llmCost + imageCostPerPanel * panels;
  return Math.round(total * 100) / 100;
}
