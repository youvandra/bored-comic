import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { config } from "./config.js";
import type { Character, ComicDelivery, ComicEvidence, DialogueType, GenerateComicInput, PageResult, PanelLayout, PanelDescription, Storyboard } from "./types.js";
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
    const isClimax = storyboard.pages.length > 1 && pageIdx === storyboard.pages.length - 1;
    const layouts = pickLayout(page.panelDescriptions.length, prevLayoutObj, firstCam, isClimax);
    pageLayouts.push(layouts);
    const panelImages: ImageGenResult[] = [];

    for (let i = 0; i < page.panelDescriptions.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1500));
      const pd = page.panelDescriptions[i]!;
      const prompt = buildPanelPrompt(pd, storyboard.characters, input.style || "manga", colorMode);

      const img = await generatePanel({ prompt, seed: jobSeed, pageNumber: page.page, panelIndex: i, workDir, jobId });
      panelImages.push(img);
    }

    await assemblePage({ panels: panelImages, layouts, pageNumber: page.page, workDir, descriptions: page.panelDescriptions, storyBeat: page.storyBeat, colorMode, pageW, pageH });

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
  const coverUrl = await assembleCover({
    storyboard,
    genre: input.genre,
    style: input.style || "manga",
    colorMode,
    workDir,
    jobId,
    pageW,
    pageH,
    seed: jobSeed,
  });
  const pdfUrl = await buildPdf(pageResults, workDir, jobId, true);

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
    coverUrl,
    pageUrls: [coverUrl, ...pageResults.map((p) => p.imageUrl)],
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

// Speech and narration are overlaid separately, so keep the art free of any
// baked-in lettering — FLUX otherwise renders garbled text that can't be read.
const NO_TEXT_TAG = " Absolutely no text, no speech bubbles, no captions, no letters, no watermark, no signature in the image.";

function styleTag(style: string): string {
  return style === "manga" ? "manga style, screentone textures, expressive line art, dynamic angles"
    : style === "western" ? "western comic style, bold inks, flat colors, confident lines"
    : style === "semi-realistic" ? "semi-realistic, detailed shading, textured, painterly"
    : "chibi style, cute proportions, large eyes, soft rendering";
}

function bwTag(colorMode: string): string {
  return colorMode === "bw"
    ? ", grayscale, high contrast, ink wash, no colors"
    : ", vibrant colors, rich palette, color harmony";
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

  return `${qualityTags}, ${styleTag(style)}${bwTag(colorMode)}. ${pd.scene}. ${charRefs}.${pd.cameraAngle ? ` Camera angle: ${pd.cameraAngle}.` : " Dynamic angle."} Single comic panel, consistent character designs.${NO_TEXT_TAG}`;
}

async function assemblePage(params: {
  panels: ImageGenResult[];
  layouts: PanelLayout[];
  pageNumber: number;
  workDir: string;
  descriptions: PanelDescription[];
  storyBeat: string;
  colorMode: string;
  pageW: number;
  pageH: number;
}): Promise<string> {
  const { panels, layouts, pageNumber, workDir, descriptions, storyBeat, colorMode, pageW, pageH } = params;
  if (panels.length === 0) return "";

  const composite: { input: string | Buffer; top: number; left: number }[] = [];
  const frames: { x: number; y: number; w: number; h: number }[] = [];

  // Panels first (bottom layer), then frames, then narration on top.
  for (let i = 0; i < panels.length; i++) {
    const layout = layouts.find((l) => l.panelIndex === i) || layouts[i % layouts.length]!;
    const pw = Math.round((pageW - GUTTER) * layout.w - GUTTER);
    const ph = Math.round((pageH - GUTTER) * layout.h - GUTTER);

    let panelBuf: Buffer = await sharp(panels[i].path)
      // "attention" keeps the salient subject (faces/action) in frame instead of
      // blindly cropping to centre.
      .resize(pw, ph, { fit: "cover", position: sharp.strategy.attention })
      .png()
      .toBuffer();

    const pd = descriptions[i];
    // SFX first (under the balloon), then the balloon on top.
    if (pd?.sfx) panelBuf = await addSfx(panelBuf, pd.sfx);
    if (pd?.dialogue) panelBuf = await addSpeechBubble(panelBuf, pd.dialogue, balloonType(pd));
    const buf = panelBuf;

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

// Pick a balloon type: honor the writer's tag, else infer from punctuation so
// exclamations still pop as shouts and internal lines read as thoughts.
function balloonType(pd: PanelDescription): DialogueType {
  const d = (pd.dialogue || "").trim();
  // Internal monologue is a deliberate writer choice — always honor it.
  if (pd.dialogueType === "thought") return "thought";
  // Otherwise let exclamations pop as shouts even if tagged plain speech.
  if (/!/.test(d) || (d.length > 1 && d === d.toUpperCase())) return "shout";
  if (pd.dialogueType === "shout") return "shout";
  if (/^\.\.\.|\.\.\.$|^\(.*\)$/.test(d)) return "thought";
  return "speech";
}

// A jagged starburst outline (shout balloon).
function burstPath(cx: number, cy: number, rx: number, ry: number, spikes = 14): string {
  const pts: string[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const isOuter = i % 2 === 0;
    const r = isOuter ? 1 : 0.78;
    const a = (Math.PI * i) / spikes - Math.PI / 2;
    pts.push(`${(cx + Math.cos(a) * rx * r).toFixed(1)},${(cy + Math.sin(a) * ry * r).toFixed(1)}`);
  }
  return pts.join(" ");
}

// A puffy cloud outline (thought balloon) built from outward arcs.
function cloudPath(x: number, y: number, w: number, h: number, r: number): string {
  const nx = Math.max(3, Math.round(w / (2 * r)));
  const ny = Math.max(2, Math.round(h / (2 * r)));
  const dx = w / nx;
  const dy = h / ny;
  let d = `M ${x} ${y}`;
  for (let i = 0; i < nx; i++) d += ` a ${dx / 2} ${r} 0 0 1 ${dx} 0`;
  for (let i = 0; i < ny; i++) d += ` a ${r} ${dy / 2} 0 0 1 0 ${dy}`;
  for (let i = 0; i < nx; i++) d += ` a ${dx / 2} ${r} 0 0 1 ${-dx} 0`;
  for (let i = 0; i < ny; i++) d += ` a ${r} ${dy / 2} 0 0 1 0 ${-dy}`;
  return d + " Z";
}

// Opaque comic balloon near the top of the panel, all-caps lettering. Shape
// varies by type: rounded speech, jagged shout, puffy thought.
async function addSpeechBubble(imageBuf: Buffer, text: string, type: DialogueType = "speech"): Promise<Buffer> {
  const meta = await sharp(imageBuf).metadata();
  const w = meta.width || 300;
  const h = meta.height || 300;

  const content = text.toUpperCase();
  const fontSize = Math.max(13, Math.min(20, Math.round(w / 22)));
  const lineH = Math.round(fontSize * 1.35);
  const avgCharW = fontSize * 0.62;
  const maxPerLine = Math.max(8, Math.floor((w * 0.78) / avgCharW));
  const maxLines = h < 200 ? 2 : h < 340 ? 3 : 4;
  const lines = wrapText(content, maxPerLine, maxLines);

  const longest = Math.max(...lines.map((l) => l.length));
  const bubbleW = Math.min(w - 16, Math.round(longest * avgCharW + fontSize * 1.8));
  const bubbleH = lines.length * lineH + Math.round(fontSize * 1.1);
  const bx = Math.round((w - bubbleW) / 2);
  const by = 12;
  const cx = w / 2;
  const tailBase = by + bubbleH;

  const textStartY = by + Math.round((bubbleH - (lines.length - 1) * lineH) / 2) + Math.round(fontSize * 0.35);
  const tspans = lines
    .map((l, i) => `<tspan x="${cx}" dy="${i === 0 ? 0 : lineH}">${escapeXml(l)}</tspan>`)
    .join("");

  let shape: string;
  if (type === "shout") {
    const pad = fontSize * 1.2;
    const pts = burstPath(cx, by + bubbleH / 2, bubbleW / 2 + pad, bubbleH / 2 + pad);
    shape = `<polygon points="${pts}" fill="#ffffff" stroke="#000000" stroke-width="3" stroke-linejoin="round"/>`;
  } else if (type === "thought") {
    const r = Math.round(fontSize * 0.7);
    shape = `<path d="${cloudPath(bx, by, bubbleW, bubbleH, r)}" fill="#ffffff" stroke="#000000" stroke-width="2.5"/>
      <circle cx="${cx - 6}" cy="${tailBase + 12}" r="6" fill="#ffffff" stroke="#000000" stroke-width="2"/>
      <circle cx="${cx - 16}" cy="${tailBase + 26}" r="4" fill="#ffffff" stroke="#000000" stroke-width="2"/>`;
  } else {
    shape = `<polygon points="${cx - 11},${tailBase - 6} ${cx + 11},${tailBase - 6} ${cx - 2},${tailBase + 16}"
               fill="#ffffff" stroke="#000000" stroke-width="2.5" stroke-linejoin="round"/>
      <rect x="${bx}" y="${by}" width="${bubbleW}" height="${bubbleH}" rx="${Math.round(bubbleH / 2.6)}" ry="${Math.round(bubbleH / 2.6)}"
            fill="#ffffff" stroke="#000000" stroke-width="2.5"/>`;
  }

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      ${shape}
      <text x="${cx}" y="${textStartY}" font-family="'Arial Black', 'Helvetica Neue', Helvetica, sans-serif"
            font-size="${fontSize}" font-weight="900" fill="#000000" text-anchor="middle">${tspans}</text>
    </svg>`;

  return sharp(imageBuf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

// Big angled onomatopoeia word art for action panels.
function sfxColor(word: string): string {
  const palette = ["#ffd23f", "#e63946", "#4cc9f0", "#ff7b00"];
  let hash = 0;
  for (let i = 0; i < word.length; i++) hash = (hash * 31 + word.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

async function addSfx(imageBuf: Buffer, sfx: string): Promise<Buffer> {
  const meta = await sharp(imageBuf).metadata();
  const w = meta.width || 300;
  const h = meta.height || 300;

  const word = sfx.toUpperCase().slice(0, 12);
  const fontSize = Math.max(30, Math.min(Math.round(w / 4.5), Math.floor((w * 0.9) / (word.length * 0.62))));
  const fill = sfxColor(word);
  const cx = Math.round(w * 0.5);
  const cy = Math.round(h * 0.66);
  const angle = -12;

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(${angle} ${cx} ${cy})">
        <text x="${cx}" y="${cy}" font-family="'Arial Black', 'Impact', sans-serif" font-size="${fontSize}" font-weight="900"
              fill="${fill}" stroke="#000000" stroke-width="${Math.max(4, Math.round(fontSize / 8))}"
              paint-order="stroke" stroke-linejoin="round" text-anchor="middle" dominant-baseline="middle">${escapeXml(word)}</text>
      </g>
    </svg>`;

  return sharp(imageBuf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

// Generate a comic-book cover: a hero key-art image with a bold title,
// genre badge, and synopsis caption overlaid.
async function assembleCover(params: {
  storyboard: Storyboard;
  genre?: string;
  style: string;
  colorMode: string;
  workDir: string;
  jobId: string;
  pageW: number;
  pageH: number;
  seed: number;
}): Promise<string> {
  const { storyboard, genre, style, colorMode, workDir, jobId, pageW, pageH, seed } = params;

  const charRefs = storyboard.characters.slice(0, 3).map((c) => `${c.name}: ${c.appearance}`).join("; ");
  const prompt = `dramatic comic book cover key art, epic dynamic hero composition, ${storyboard.synopsis}. Main characters: ${charRefs}. ${styleTag(style)}${bwTag(colorMode)}. highly detailed, bold linework, poster-worthy.${NO_TEXT_TAG}`;

  const hero = await generatePanel({ prompt, seed, pageNumber: 0, panelIndex: 0, workDir, jobId });
  const bg = await sharp(hero.path)
    .resize(pageW, pageH, { fit: "cover", position: sharp.strategy.attention })
    .png()
    .toBuffer();

  let pipeline = sharp(bg).composite([
    { input: renderCoverOverlay(storyboard.title, genre, storyboard.synopsis, pageW, pageH), top: 0, left: 0 },
  ]);
  if (colorMode === "bw") pipeline = pipeline.grayscale();

  await pipeline.png().toFile(join(workDir, "cover.png"));
  return `/comics/${jobId}/cover.png`;
}

function renderCoverOverlay(title: string, genre: string | undefined, synopsis: string, pageW: number, pageH: number): Buffer {
  const M = GUTTER + 6;

  // Genre badge (top-left).
  const genreLabel = (genre || "comic").toUpperCase();
  const badgeW = genreLabel.length * 12 + 28;
  const badgeH = 32;

  // Big outlined title, centered near the top. Arial Black glyphs are wide
  // (~0.92em each), so size to fit the widest line within the page margins.
  const titleLines = wrapText(title.toUpperCase(), 11, 2);
  const longest = Math.max(...titleLines.map((l) => l.length), 1);
  const titleSize = Math.max(34, Math.min(Math.round(pageW / 7), Math.floor((pageW - M * 2) / (longest * 0.92))));
  const titleLineH = Math.round(titleSize * 1.02);
  const titleBaseline = M + badgeH + 28 + titleSize;
  const titleSpans = titleLines
    .map((l, i) => `<tspan x="${pageW / 2}" dy="${i === 0 ? 0 : titleLineH}">${escapeXml(l)}</tspan>`)
    .join("");

  // Synopsis caption box (bottom).
  const synSize = 16;
  const synLineH = 22;
  const synMaxPerLine = Math.max(16, Math.floor((pageW - M * 2 - 24) / (synSize * 0.5)));
  const synLines = wrapText(synopsis, synMaxPerLine, 3);
  const synBoxH = synLines.length * synLineH + 20;
  const synY = pageH - M - synBoxH;
  const synSpans = synLines
    .map((l, i) => `<tspan x="${M + 12}" dy="${i === 0 ? 0 : synLineH}">${escapeXml(l)}</tspan>`)
    .join("");

  const svg = `<svg width="${pageW}" height="${pageH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="topScrim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#000000" stop-opacity="0.6"/>
          <stop offset="1" stop-color="#000000" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${pageW}" height="${Math.round(pageH * 0.3)}" fill="url(#topScrim)"/>

      <rect x="${M}" y="${M}" width="${badgeW}" height="${badgeH}" rx="4" fill="#e63946" stroke="#000000" stroke-width="3"/>
      <text x="${M + badgeW / 2}" y="${M + badgeH / 2 + 6}" font-family="'Arial Black', sans-serif" font-size="17" font-weight="900" fill="#ffffff" text-anchor="middle">${escapeXml(genreLabel)}</text>

      <text x="${pageW / 2}" y="${titleBaseline}" font-family="'Arial Black', 'Helvetica', sans-serif" font-size="${titleSize}" font-weight="900"
            fill="#ffd23f" stroke="#000000" stroke-width="${Math.max(3, Math.round(titleSize / 12))}" paint-order="stroke" stroke-linejoin="round"
            text-anchor="middle">${titleSpans}</text>

      <rect x="${M}" y="${synY}" width="${pageW - M * 2}" height="${synBoxH}" rx="3" fill="#f5e9c8" stroke="#000000" stroke-width="3"/>
      <text x="${M + 12}" y="${synY + 22}" font-family="Georgia, 'Times New Roman', serif" font-size="${synSize}" font-style="italic" fill="#1a1a1a">${synSpans}</text>

      <text x="${pageW - M}" y="${synY - 12}" font-family="'Arial Black', sans-serif" font-size="15" font-weight="900"
            fill="#ffffff" stroke="#000000" stroke-width="0.8" paint-order="stroke" text-anchor="end">BOREDCOMIC</text>
    </svg>`;

  return Buffer.from(svg);
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
