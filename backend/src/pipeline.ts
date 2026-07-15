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

const PAGE_W = 800;
const PAGE_H = 1067;
const GUTTER = 8;

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

  hooks.setStatus("writing");
  const storyboard = await generateStoryboard(input);

  hooks.setStatus("illustrating");
  const totalPanels = storyboard.pages.reduce((s, p) => s + p.panels, 0);

  const pageTasks = storyboard.pages.map(async (page) => {
    const layouts = pickLayout(page.panelDescriptions.length);
    const panelImages: ImageGenResult[] = [];

    for (let i = 0; i < page.panelDescriptions.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1500));
      const pd = page.panelDescriptions[i]!;
      const layout = layouts.find((l) => l.panelIndex === i) || layouts[i % layouts.length]!;
      const prompt = buildPanelPrompt(pd, storyboard.characters, input.style || "manga", colorMode);
      const pw = Math.round((PAGE_W - GUTTER) * layout.w - GUTTER);
      const ph = Math.round((PAGE_H - GUTTER) * layout.h - GUTTER);

      const img = await generatePanel({ prompt, targetW: pw, targetH: ph, pageNumber: page.page, panelIndex: i, workDir, jobId });
      panelImages.push(img);
    }

    await assemblePage({ panels: panelImages, layouts, pageNumber: page.page, workDir, dialogue: page.panelDescriptions.map((pd) => pd.dialogue), colorMode });

    return {
      page: page.page,
      panels: page.panels,
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

  const summary = `${input.pages}-page ${input.genre || "story"} ${input.style || "manga"} '${storyboard.title}': ${totalPanels} panels, ${storyboard.characters.length} characters. Generated in ${elapsedSec}s. Language: ${lang}. Color mode: ${colorMode}.`;

  return {
    jobId,
    summary,
    title: storyboard.title,
    pages: input.pages,
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
      pagesGenerated: input.pages,
      panelsGenerated: totalPanels,
      generationTimeSec: elapsedSec,
      costEstimateUsd: estimateCost(input.pages, totalPanels),
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

  const qualityTags = "highly detailed, sharp focus, cinematic composition";
  const styleTag = style === "manga" ? "manga style, screentone textures, expressive line art, dynamic angles"
    : style === "western" ? "western comic style, bold inks, flat colors, confident lines"
    : style === "semi-realistic" ? "semi-realistic, detailed shading, textured, painterly"
    : "chibi style, cute proportions, large eyes, soft rendering";

  const bwTag = colorMode === "bw"
    ? ", grayscale, high contrast, ink wash, no colors"
    : ", vibrant colors, rich palette, color harmony";

  return `${qualityTags}, ${styleTag}${bwTag}. ${pd.scene}. ${charRefs}.${pd.dialogue ? ` Speaking: "${pd.dialogue}"` : ""}${pd.cameraAngle ? ` Camera angle: ${pd.cameraAngle}.` : " Dynamic angle."} Single comic panel, consistent character designs.`;
}

async function assemblePage(params: {
  panels: ImageGenResult[];
  layouts: PanelLayout[];
  pageNumber: number;
  workDir: string;
  dialogue: (string | undefined)[];
  colorMode: string;
}): Promise<string> {
  const { panels, layouts, pageNumber, workDir, dialogue, colorMode } = params;
  if (panels.length === 0) return "";

  const composite: { input: string | Buffer; top: number; left: number }[] = [];

  for (let i = 0; i < panels.length; i++) {
    const layout = layouts.find((l) => l.panelIndex === i) || layouts[i % layouts.length]!;
    const pw = Math.round((PAGE_W - GUTTER) * layout.w - GUTTER);
    const ph = Math.round((PAGE_H - GUTTER) * layout.h - GUTTER);

    const pngBuf = await sharp(panels[i].path)
      .resize(pw, ph, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();

    const diag = dialogue[i];
    const buf = diag ? await addSpeechBubble(pngBuf, diag) : pngBuf;

    const x = Math.round(GUTTER + (PAGE_W - GUTTER) * layout.x);
    const y = Math.round(GUTTER + (PAGE_H - GUTTER) * layout.y);

    composite.push({ input: buf as Buffer, top: y, left: x });
  }

  const outputPath = join(workDir, `page-${pageNumber}.png`);
  let pipeline = sharp({
    create: {
      width: PAGE_W,
      height: PAGE_H,
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

async function addSpeechBubble(imageBuf: Buffer, text: string): Promise<Buffer> {
  const meta = await sharp(imageBuf).metadata();
  const w = meta.width || 300;
  const h = meta.height || 300;

  const padX = 8;
  const padY = 6;
  const availW = w - padX * 2 - 8;
  const fontSize = 14;
  const lineH = 20;
  const avgCharW = 8;
  const maxPerLine = Math.max(10, Math.floor(availW / avgCharW));

  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).length > maxPerLine) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) lines.push(current);

  const totalLines = Math.min(lines.length, 5);
  const bubbleH = totalLines * lineH + padY * 2;
  const bubbleY = Math.max(0, h - bubbleH - padY);

  const tspans = lines.slice(0, totalLines).map((line, i) =>
    `<tspan x="${w / 2}" dy="${i === 0 ? 0 : lineH}" dominant-baseline="middle">${escapeXml(line)}</tspan>`
  ).join("");

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${padX}" y="${bubbleY}" width="${w - padX * 2}" height="${bubbleH}" rx="6" ry="6"
            fill="white" fill-opacity="0.88" stroke="black" stroke-width="1.2"/>
      <text x="${w / 2}" y="${bubbleY + padY + lineH / 2}" font-family="sans-serif" font-size="${fontSize}" font-weight="bold"
            fill="black" text-anchor="middle">${tspans}</text>
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
