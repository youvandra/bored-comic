import { bangers, comicNeue, linePath, fitFontSize } from "./fonts.js";
import { mkdir, readdir, unlink } from "node:fs/promises";
import fs from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { config } from "./config.js";
import type { Character, ComicDelivery, DialogueType, GenerateComicInput, LayoutMode, PageResult, PageSpec, PanelDetail, PanelLayout, PanelDescription, StoredCharacter, Storyboard } from "./types.js";
import { pickLayout } from "./types.js";
import { generateStoryboard, reviseStoryboardPage, type StoryboardOptions } from "./writer.js";
import { generatePanel, type ImageGenResult } from "./illustrator.js";
import { buildPdf } from "./assembler.js";
import { buildCbz } from "./cbz.js";
import { buildIntegrity, buildLicense, buildReceipt } from "./receipt.js";
import { appendEpisode, getCharacters, getJob, getSeries, saveJob } from "./store.js";

export interface PipelineHooks {
  setStatus(status: string): void;
}

const GUTTER = 14;
const FRAME_STROKE = 4; // black ink border around each panel
export const MODEL_ID = "@cf/black-forest-labs/flux-1-schnell";

// Page dimensions per aspect ratio. Base width ~800px, height derived.
export function pageDims(aspectRatio?: string): { width: number; height: number } {
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

// Webtoon mode: full-width square-ish panels stacked vertically, page height
// derived from the panel count. Rendering reuses the normal page assembler —
// only the layout fractions and canvas size differ.
const WEBTOON_WIDTH = 800;
const WEBTOON_PANEL_H = 800;

export function webtoonDims(panelCount: number): { width: number; height: number } {
  return {
    width: WEBTOON_WIDTH,
    height: GUTTER + panelCount * (WEBTOON_PANEL_H + GUTTER),
  };
}

export function webtoonLayouts(panelCount: number): PanelLayout[] {
  return Array.from({ length: panelCount }, (_, i) => ({
    panelIndex: i,
    x: 0,
    y: i / panelCount,
    w: 1,
    h: 1 / panelCount,
  }));
}

// Plain-language description of a panel — usable directly as image alt text.
export function panelAltText(pd: PanelDescription): string {
  const scene = pd.scene.replace(/\.?\s*$/, ".");
  const chars = pd.characters?.length ? ` Characters: ${pd.characters.join(", ")}.` : "";
  const dlg = pd.dialogue ? ` Dialogue: "${pd.dialogue}"${pd.dialogue2 ? ` / "${pd.dialogue2}"` : ""}.` : "";
  const sfx = pd.sfx ? ` Sound effect: ${pd.sfx}.` : "";
  return `${scene}${chars}${dlg}${sfx}`;
}

// Render one storyboard page: generate its panels, letter and assemble it,
// return the PageResult. Shared by runPipeline and revisePage.
async function renderStoryPage(params: {
  page: PageSpec;
  layouts: PanelLayout[];
  storyboard: Storyboard;
  jobId: string;
  workDir: string;
  jobSeed: number;
  style: string;
  colorMode: string;
  genre?: string;
  pageW: number;
  pageH: number;
  characterCaveat: string;
}): Promise<PageResult> {
  const { page, layouts, storyboard, jobId, workDir, jobSeed, style, colorMode, genre, pageW, pageH, characterCaveat } = params;
  const panelImages: ImageGenResult[] = [];

  for (let i = 0; i < page.panelDescriptions.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1500));
    const pd = page.panelDescriptions[i]!;
    const prompt = buildPanelPrompt(pd, storyboard.characters, style, colorMode);

    let img: ImageGenResult;
    try {
      img = await generatePanel({ prompt, seed: jobSeed, pageNumber: page.page, panelIndex: i, workDir, jobId });
    } catch {
      // A single unrecoverable panel (safety filter, exhausted quota) must not
      // sink an already-paid comic — drop in a styled placeholder and continue.
      img = await makePlaceholderPanel(workDir, page.page, i);
    }
    panelImages.push(img);
  }

  await assemblePage({ panels: panelImages, layouts, pageNumber: page.page, workDir, descriptions: page.panelDescriptions, storyBeat: page.storyBeat, colorMode, genre, pageW, pageH });

  const panelDetails: PanelDetail[] = page.panelDescriptions.map((pd, i) => ({
    panel: i + 1,
    imageUrl: `/comics/${jobId}/panel-${page.page}-${i}.png`,
    altText: panelAltText(pd),
    dialogue: pd.dialogue,
    dialogue2: pd.dialogue2,
    sfx: pd.sfx,
    cameraAngle: pd.cameraAngle,
  }));

  return {
    page: page.page,
    panels: page.panelDescriptions.length,
    storyBeat: page.storyBeat,
    imageUrl: `/comics/${jobId}/page-${page.page}.png`,
    panelDetails,
    evidence: {
      model: MODEL_ID,
      promptChars: panelImages.reduce((s, p) => s + p.promptChars, 0),
      characterCount: page.panelDescriptions.reduce((s, pd) => Math.max(s, pd.characters.length), 0),
      layout: `${layouts.length}p`,
      caveat: characterCaveat,
    },
  };
}

// Every file a job can deliver — hashed for the integrity map.
function deliverableFiles(storyboard: Storyboard, layoutMode: LayoutMode): string[] {
  const files = ["cover.png", "comic.pdf", "comic.cbz", "endcard.png"];
  if (layoutMode === "webtoon") files.push("strip.png");
  for (const page of storyboard.pages) {
    files.push(`page-${page.page}.png`);
    page.panelDescriptions.forEach((_, i) => files.push(`panel-${page.page}-${i}.png`));
  }
  return files;
}

export async function runPipeline(
  jobId: string,
  input: GenerateComicInput,
  hooks: PipelineHooks,
): Promise<ComicDelivery> {
  const workDir = join(config.comicDir, jobId);
  await mkdir(workDir, { recursive: true });
  const startTime = Date.now();
  const layoutMode: LayoutMode = input.layoutMode === "webtoon" ? "webtoon" : "page";

  // Series: fill unset input fields from series defaults, union its fixed cast.
  const series = input.seriesId ? getSeries(input.seriesId) : null;
  if (input.seriesId && !series) throw new Error(`Unknown seriesId: ${input.seriesId}`);
  if (series) {
    input = {
      ...input,
      genre: input.genre ?? series.genre,
      style: input.style ?? series.style,
      language: input.language ?? series.language,
      colorMode: input.colorMode ?? series.colorMode,
    };
  }
  const characterIds = [...new Set([...(input.characterIds ?? []), ...(series?.characterIds ?? [])])];

  // Registered characters: canonical appearance text + stable seeds.
  const storedChars: StoredCharacter[] = characterIds.length > 0 ? getCharacters(characterIds) : [];
  if (storedChars.length !== characterIds.length) {
    const found = new Set(storedChars.map((c) => c.characterId));
    const missing = characterIds.filter((id) => !found.has(id));
    throw new Error(`Unknown characterId(s): ${missing.join(", ")}`);
  }

  const lang = input.language || "en";
  const colorMode = input.colorMode || "color";
  const style = input.style || "manga";
  const { width: pageW, height: pageH } = pageDims(input.aspectRatio);

  // One seed per job so panels share a coherent visual baseline. With
  // registered characters the seed is derived from their stored seeds, so the
  // same cast keeps the same baseline across every comic they appear in.
  const jobSeed = storedChars.length > 0
    ? storedChars.reduce((s, c) => (s ^ c.seed) >>> 0, 0x9e3779b9)
    : Math.floor(Math.random() * 1_000_000_000);

  hooks.setStatus("writing");
  const opts: StoryboardOptions = {
    fixedCharacters: storedChars.map((c) => ({ name: c.name, role: c.role, appearance: c.appearance })),
    seriesContext: series
      ? {
          seriesTitle: series.title,
          episodes: series.episodes.map((e) => ({ episode: e.episode, title: e.title, endingSummary: e.endingSummary })),
        }
      : undefined,
  };
  const storyboard = await generateStoryboard(input, opts);

  hooks.setStatus("illustrating");
  // Layouts chosen up front (sequentially) so each page can still avoid
  // repeating the previous page's layout while pages render in parallel.
  const pageLayouts: PanelLayout[][] = [];
  const pageDimsList: { width: number; height: number }[] = [];
  storyboard.pages.forEach((page, pageIdx) => {
    if (layoutMode === "webtoon") {
      pageLayouts.push(webtoonLayouts(page.panelDescriptions.length));
      pageDimsList.push(webtoonDims(page.panelDescriptions.length));
    } else {
      const firstCam = page.panelDescriptions[0]?.cameraAngle;
      const isClimax = storyboard.pages.length > 1 && pageIdx === storyboard.pages.length - 1;
      pageLayouts.push(pickLayout(page.panelDescriptions.length, pageLayouts[pageIdx - 1] ?? null, firstCam, isClimax));
      pageDimsList.push({ width: pageW, height: pageH });
    }
  });

  const characterCaveat = storedChars.length > 0
    ? "Registered characters use canonical appearance text and a stable seed — appearance may still vary slightly across panels."
    : "Generated from text prompt — character appearance may vary slightly across pages.";

  const pageResults = await Promise.all(
    storyboard.pages.map((page, pageIdx) =>
      renderStoryPage({
        page,
        layouts: pageLayouts[pageIdx],
        storyboard,
        jobId,
        workDir,
        jobSeed,
        style,
        colorMode,
        genre: input.genre,
        pageW: pageDimsList[pageIdx].width,
        pageH: pageDimsList[pageIdx].height,
        characterCaveat,
      }),
    ),
  );

  hooks.setStatus("assembling");
  // Cover and end card keep the standard page shape even in webtoon mode.
  const coverDims = layoutMode === "webtoon" ? pageDims("3:4") : { width: pageW, height: pageH };
  const coverUrl = await assembleCover({
    storyboard,
    genre: input.genre,
    style,
    colorMode,
    workDir,
    jobId,
    pageW: coverDims.width,
    pageH: coverDims.height,
    seed: jobSeed,
  });
  await makeEndCard(workDir, coverDims.width, coverDims.height, colorMode);
  const pdfUrl = await buildPdf(pageResults, workDir, jobId, true, storyboard.title);
  const cbzUrl = buildCbz(workDir, jobId, pageResults.map((p) => p.page));

  let stripUrl: string | undefined;
  if (layoutMode === "webtoon") {
    stripUrl = await makeWebtoonStrip(workDir, jobId, pageResults.map((p) => p.page));
  }

  const elapsedSec = Math.round((Date.now() - startTime) / 1000);

  // Honest counts: derived from what was actually generated.
  const actualPages = pageResults.length;
  const totalPanels = pageResults.reduce((s, p) => s + p.panels, 0);

  // Persist everything revise_page needs, then log the episode if in a series.
  const now = new Date().toISOString();
  saveJob({
    jobId,
    input: { ...input, characterIds },
    storyboard,
    seed: jobSeed,
    pageW,
    pageH,
    layoutMode,
    characterIds,
    seriesId: input.seriesId,
    createdAt: now,
    updatedAt: now,
  });

  let episode: number | undefined;
  if (series) {
    const ep = appendEpisode(series.seriesId, {
      jobId,
      title: storyboard.title,
      synopsis: storyboard.synopsis,
      endingSummary: storyboard.endingSummary || storyboard.synopsis,
      createdAt: now,
    });
    episode = ep?.episode;
  }

  const integrity = buildIntegrity(workDir, deliverableFiles(storyboard, layoutMode));
  const receipt = buildReceipt(jobId, integrity);
  const license = buildLicense(MODEL_ID, jobSeed, input.prompt);

  const summary = `${actualPages}-page ${input.genre || "story"} ${style} '${storyboard.title}': ${totalPanels} panels, ${storyboard.characters.length} characters. Generated in ${elapsedSec}s. Language: ${lang}. Color mode: ${colorMode}.${layoutMode === "webtoon" ? " Layout: webtoon (vertical strip)." : ""}${episode ? ` Episode ${episode} of series ${input.seriesId}.` : ""}`;

  return {
    jobId,
    summary,
    title: storyboard.title,
    pages: actualPages,
    totalPanels,
    style,
    genre: input.genre || "slice-of-life",
    language: lang,
    colorMode,
    layoutMode,
    characters: storyboard.characters,
    characterIds: characterIds.length > 0 ? characterIds : undefined,
    seriesId: input.seriesId,
    episode,
    coverUrl,
    pageUrls: [coverUrl, ...pageResults.map((p) => p.imageUrl)],
    pdfUrl,
    cbzUrl,
    stripUrl,
    perPage: pageResults,
    integrity,
    receipt,
    license,
    evidence: {
      model: MODEL_ID,
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

// All rendered pages stacked into one tall image — the format webtoon
// platforms ingest directly.
async function makeWebtoonStrip(workDir: string, jobId: string, pageNumbers: number[]): Promise<string | undefined> {
  const buffers: { buf: Buffer; w: number; h: number }[] = [];
  for (const n of pageNumbers) {
    const p = join(workDir, `page-${n}.png`);
    if (!fs.existsSync(p)) continue;
    const img = sharp(p);
    const meta = await img.metadata();
    buffers.push({ buf: await img.png().toBuffer(), w: meta.width || WEBTOON_WIDTH, h: meta.height || 0 });
  }
  if (buffers.length === 0) return undefined;

  const width = Math.max(...buffers.map((b) => b.w));
  const height = buffers.reduce((s, b) => s + b.h, 0);
  // Guard against pathological canvas sizes (sharp/libvips limits).
  if (height > 60_000) return undefined;

  let top = 0;
  const composite = buffers.map((b) => {
    const layer = { input: b.buf, top, left: Math.round((width - b.w) / 2) };
    top += b.h;
    return layer;
  });

  await sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite(composite)
    .png()
    .toFile(join(workDir, "strip.png"));
  return `/comics/${jobId}/strip.png`;
}

export interface PageRevision {
  jobId: string;
  page: number;
  instruction: string;
  imageUrl: string;
  storyBeat: string;
  panelDetails: PanelDetail[];
  pdfUrl: string | null;
  cbzUrl: string | null;
  integrity: ReturnType<typeof buildIntegrity>;
  receipt: ReturnType<typeof buildReceipt>;
  note: string;
}

// Revise one page of a previously generated comic: the writer rewrites the
// page spec per the instruction, panels regenerate with the job's original
// seed and cast, and the PDF/CBZ are rebuilt when the other pages still exist.
export async function revisePage(
  jobId: string,
  pageNumber: number,
  instruction: string,
  hooks: PipelineHooks,
): Promise<PageRevision> {
  const job = getJob(jobId);
  if (!job) throw new Error(`Unknown or expired jobId: ${jobId}. Jobs are revisable for ${Math.round(config.jobTtlMs / 86_400_000)} days.`);
  const original = job.storyboard.pages.find((p) => p.page === pageNumber);
  if (!original) throw new Error(`Job ${jobId} has no page ${pageNumber}.`);

  const workDir = join(config.comicDir, jobId);
  await mkdir(workDir, { recursive: true });

  hooks.setStatus("revising");
  const revised = await reviseStoryboardPage(job.storyboard, pageNumber, instruction, job.input.language || "en");

  // Stale panel files from the old version of this page would otherwise leak
  // into the integrity map when the revision has fewer panels.
  for (const f of await readdir(workDir)) {
    if (f.startsWith(`panel-${pageNumber}-`)) await unlink(join(workDir, f)).catch(() => {});
  }

  hooks.setStatus("illustrating");
  const layouts = job.layoutMode === "webtoon"
    ? webtoonLayouts(revised.panelDescriptions.length)
    : pickLayout(revised.panelDescriptions.length, null, revised.panelDescriptions[0]?.cameraAngle);
  const dims = job.layoutMode === "webtoon"
    ? webtoonDims(revised.panelDescriptions.length)
    : { width: job.pageW, height: job.pageH };

  const colorMode = job.input.colorMode || "color";
  const pageResult = await renderStoryPage({
    page: revised,
    layouts,
    storyboard: { ...job.storyboard, pages: job.storyboard.pages.map((p) => (p.page === pageNumber ? revised : p)) },
    jobId,
    workDir,
    jobSeed: job.seed,
    style: job.input.style || "manga",
    colorMode,
    genre: job.input.genre,
    pageW: dims.width,
    pageH: dims.height,
    characterCaveat: "Revised page — regenerated with the job's original seed and cast.",
  });

  // Persist the revision so further revisions build on it.
  job.storyboard.pages = job.storyboard.pages.map((p) => (p.page === pageNumber ? revised : p));
  job.updatedAt = new Date().toISOString();
  saveJob(job);

  hooks.setStatus("assembling");
  // PDF/CBZ can only be rebuilt while every other page image is still on disk.
  const allPagesExist = job.storyboard.pages.every((p) => fs.existsSync(join(workDir, `page-${p.page}.png`)));
  let pdfUrl: string | null = null;
  let cbzUrl: string | null = null;
  let note = `Page ${pageNumber} revised. Original comic files expired, so the PDF/CBZ were not rebuilt — regenerate or download the revised page image directly.`;
  if (allPagesExist) {
    const fakeResults = job.storyboard.pages.map((p) => ({ page: p.page })) as PageResult[];
    pdfUrl = await buildPdf(fakeResults, workDir, jobId, true, job.storyboard.title);
    cbzUrl = buildCbz(workDir, jobId, job.storyboard.pages.map((p) => p.page));
    note = `Page ${pageNumber} revised; PDF and CBZ rebuilt with the new page.`;
  }

  const integrity = buildIntegrity(workDir, deliverableFiles(job.storyboard, job.layoutMode));
  const receipt = buildReceipt(jobId, integrity);

  return {
    jobId,
    page: pageNumber,
    instruction,
    imageUrl: pageResult.imageUrl,
    storyBeat: revised.storyBeat,
    panelDetails: pageResult.panelDetails,
    pdfUrl,
    cbzUrl,
    integrity,
    receipt,
    note,
  };
}

// Subtle per-genre color grade applied to the finished page/cover (color mode
// only — B&W already carries its mood through grayscale). Values stay close to
// 1.0 on purpose: a mood shift, not a filter.
export const GENRE_GRADES: Record<string, { saturation: number; brightness: number }> = {
  horror: { saturation: 0.72, brightness: 0.92 }, // drained, cold dread
  "sci-fi": { saturation: 0.9, brightness: 0.97 }, // slightly clinical
  romance: { saturation: 1.1, brightness: 1.05 }, // warm, soft lift
  comedy: { saturation: 1.12, brightness: 1.06 }, // bright and bouncy
  action: { saturation: 1.15, brightness: 1.0 }, // punchy chroma
  fantasy: { saturation: 1.08, brightness: 1.02 }, // lush
};

function applyGenreGrade(img: ReturnType<typeof sharp>, genre: string | undefined, colorMode: string): ReturnType<typeof sharp> {
  if (colorMode === "bw" || !genre) return img;
  const g = GENRE_GRADES[genre];
  if (!g) return img;
  return img.modulate({ saturation: g.saturation, brightness: g.brightness });
}

// Speech and narration are overlaid separately, so keep the art free of any
// baked-in lettering — FLUX otherwise renders garbled text that can't be read.
export const NO_TEXT_TAG = " Absolutely no text, no speech bubbles, no captions, no letters, no watermark, no signature in the image.";

export function styleTag(style: string): string {
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
  genre?: string;
  pageW: number;
  pageH: number;
}): Promise<string> {
  const { panels, layouts, pageNumber, workDir, descriptions, storyBeat, colorMode, genre, pageW, pageH } = params;
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
    // Keep lettering off the focal subject (usually centered): balloons hug a
    // top corner, SFX sits low. Panel 0 avoids the top-left narration caption.
    const anchor: BalloonAnchor = i === 0 && storyBeat ? "right" : i % 2 === 0 ? "left" : "right";
    // SFX first (under the balloon), then the balloon on top.
    if (pd?.sfx) panelBuf = await addSfx(panelBuf, pd.sfx);
    if (pd?.dialogue) {
      const first = await addSpeechBubble(panelBuf, pd.dialogue, balloonType(pd), anchor);
      panelBuf = first.buf;
      // Second speaker's reply: opposite corner, below the first (reading order).
      if (pd.dialogue2) {
        const anchor2: BalloonAnchor = anchor === "left" ? "right" : "left";
        const type2 = balloonType({ ...pd, dialogue: pd.dialogue2, dialogueType: pd.dialogue2Type });
        panelBuf = (await addSpeechBubble(panelBuf, pd.dialogue2, type2, anchor2, first.bottom - 4)).buf;
      }
    }
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
  } else {
    pipeline = applyGenreGrade(pipeline, genre, colorMode);
  }

  await pipeline.png().toFile(outputPath);
  return outputPath;
}

// Word-wrap into at most maxLines lines. If it overflows, the last line ends
// with an ellipsis at a word boundary — never mid-word.
export function wrapText(text: string, maxPerLine: number, maxLines: number): string[] {
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

// Classic cream narration caption box, top-left corner, sized to its text so it
// covers as little art as possible (max two lines).
function renderNarration(text: string, pageW: number, pageH: number): Buffer {
  const primary = text.split(";").map((s) => s.trim()).filter(Boolean)[0] || text;
  const padX = 14;
  const padY = 9;
  const fontSize = 15;
  const lineH = 21;
  const charW = fontSize * 0.5; // serif italic average
  const hardMax = Math.floor((pageW * 0.6 - padX * 2) / charW);
  const lines = wrapText(primary, hardMax, 2);
  const longest = Math.max(...lines.map((l) => l.length), 1);
  const boxW = Math.min(Math.round(pageW * 0.6), Math.round(longest * charW + padX * 2));
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
export function balloonType(pd: PanelDescription): DialogueType {
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

type BalloonAnchor = "left" | "center" | "right";

// Opaque comic balloon near the top of the panel, all-caps lettering. Shape
// varies by type: rounded speech, jagged shout, puffy thought. `anchor` hugs a
// corner so the balloon covers less of the focal subject; `yOffset` pushes the
// balloon down (used to stack a second speaker's reply). Returns the lettered
// image plus the y where the balloon (tail included) ends.
async function addSpeechBubble(imageBuf: Buffer, text: string, type: DialogueType = "speech", anchor: BalloonAnchor = "center", yOffset = 0): Promise<{ buf: Buffer; bottom: number }> {
  const meta = await sharp(imageBuf).metadata();
  const w = meta.width || 300;
  const h = meta.height || 300;

  const content = text.toUpperCase();
  const fontSize = Math.max(13, Math.min(20, Math.round(w / 22)));
  const lineH = Math.round(fontSize * 1.35);
  const avgCharW = comicNeue.getAdvanceWidth("ABCDEFGHIJKLMNOPQRSTUVWXYZ ", fontSize) / 27;
  const maxPerLine = Math.max(8, Math.floor((w * 0.78) / avgCharW));
  const maxLines = h < 200 ? 2 : h < 340 ? 3 : 4;
  const lines = wrapText(content, maxPerLine, maxLines);

  const textW = Math.max(...lines.map((l) => comicNeue.getAdvanceWidth(l, fontSize)));
  const bubbleW = Math.min(w - 16, Math.round(textW + fontSize * 1.8));
  const bubbleH = lines.length * lineH + Math.round(fontSize * 1.1);
  const sideMargin = 10;
  const bx = anchor === "left" ? sideMargin
    : anchor === "right" ? w - bubbleW - sideMargin
    : Math.round((w - bubbleW) / 2);
  const by = 12 + yOffset;
  const cx = bx + bubbleW / 2;
  const tailBase = by + bubbleH;

  const textStartY = by + Math.round((bubbleH - (lines.length - 1) * lineH) / 2) + Math.round(fontSize * 0.35);
  const textPaths = lines
    .map((l, i) => `<path d="${linePath(comicNeue, l, fontSize, cx, textStartY + i * lineH).d}" fill="#000000"/>`)
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
      ${textPaths}
    </svg>`;

  const buf = await sharp(imageBuf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
  return { buf, bottom: tailBase + (type === "thought" ? 32 : 18) };
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
  // Target a fraction of the width that leaves room for the -12° rotation, so
  // the whole word stays inside the panel instead of clipping at the edge.
  const fontSize = fitFontSize(bangers, word, w * 0.78, Math.round(w / 4), 26);
  const fill = sfxColor(word);
  const cx = Math.round(w * 0.5);
  const cy = Math.round(h * 0.76);
  const angle = -11;
  const { d } = linePath(bangers, word, fontSize, cx, cy + fontSize * 0.34);

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(${angle} ${cx} ${cy})">
        <path d="${d}" fill="${fill}" stroke="#000000" stroke-width="${Math.max(4, Math.round(fontSize / 8))}"
              paint-order="stroke" stroke-linejoin="round"/>
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
  else pipeline = applyGenreGrade(pipeline, genre, colorMode);

  await pipeline.png().toFile(join(workDir, "cover.png"));
  return `/comics/${jobId}/cover.png`;
}

function renderCoverOverlay(title: string, genre: string | undefined, synopsis: string, pageW: number, pageH: number): Buffer {
  const M = GUTTER + 6;

  // Genre badge (top-left), lettered in Bangers.
  const genreLabel = (genre || "comic").toUpperCase();
  const badgeH = 34;
  const genreSize = 20;
  const badgeW = Math.round(bangers.getAdvanceWidth(genreLabel, genreSize)) + 26;
  const genrePath = linePath(bangers, genreLabel, genreSize, M + badgeW / 2, M + badgeH / 2 + genreSize * 0.35).d;

  // Big outlined title, centered near the top. Size to fit the widest line.
  const titleLines = wrapText(title.toUpperCase(), 16, 2);
  const titleSize = Math.min(...titleLines.map((l) => fitFontSize(bangers, l, pageW - M * 2, Math.round(pageW / 5), 40)));
  const titleLineH = Math.round(titleSize * 0.92);
  const titleBaseline = M + badgeH + 24 + titleSize;
  const titlePaths = titleLines
    .map((l, i) => `<path d="${linePath(bangers, l, titleSize, pageW / 2, titleBaseline + i * titleLineH).d}"
            fill="#ffd23f" stroke="#000000" stroke-width="${Math.max(3, Math.round(titleSize / 12))}" paint-order="stroke" stroke-linejoin="round"/>`)
    .join("");

  // Byline, bottom-right, right-aligned.
  const bylineText = "BOREDCOMIC";
  const bylineSize = 20;
  const bylineW = bangers.getAdvanceWidth(bylineText, bylineSize);

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
      <path d="${genrePath}" fill="#ffffff"/>

      ${titlePaths}

      <rect x="${M}" y="${synY}" width="${pageW - M * 2}" height="${synBoxH}" rx="3" fill="#f5e9c8" stroke="#000000" stroke-width="3"/>
      <text x="${M + 12}" y="${synY + 22}" font-family="Georgia, 'Times New Roman', serif" font-size="${synSize}" font-style="italic" fill="#1a1a1a">${synSpans}</text>

      <path d="${linePath(bangers, bylineText, bylineSize, pageW - M - bylineW / 2, synY - 12).d}"
            fill="#ffffff" stroke="#000000" stroke-width="0.8" paint-order="stroke"/>
    </svg>`;

  return Buffer.from(svg);
}

// A "THE END" back card appended to the PDF, in the comic's page shape.
async function makeEndCard(workDir: string, pageW: number, pageH: number, colorMode: string): Promise<void> {
  const endSize = fitFontSize(bangers, "THE END", pageW * 0.7, Math.round(pageW / 4), 44);
  const endD = linePath(bangers, "THE END", endSize, pageW / 2, pageH / 2 + endSize * 0.34).d;
  const byD = linePath(bangers, "BOREDCOMIC", 28, pageW / 2, pageH * 0.66).d;

  const svg = `<svg width="${pageW}" height="${pageH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${pageW}" height="${pageH}" fill="#1a1a2e"/>
      <path d="${endD}" fill="#ffd23f" stroke="#000000" stroke-width="${Math.max(4, Math.round(endSize / 12))}" paint-order="stroke" stroke-linejoin="round"/>
      <path d="${byD}" fill="#ffffff" stroke="#000000" stroke-width="1" paint-order="stroke"/>
    </svg>`;

  let pipeline = sharp(Buffer.from(svg));
  if (colorMode === "bw") pipeline = pipeline.grayscale();
  await pipeline.png().toFile(join(workDir, "endcard.png"));
}

// Styled fallback panel for the rare case a panel can't be generated at all.
async function makePlaceholderPanel(workDir: string, pageNumber: number, panelIndex: number): Promise<ImageGenResult> {
  const size = 768;
  const { d } = linePath(bangers, "?!", 300, size / 2, size / 2 + 100);
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="#1a1a2e"/>
      <path d="${d}" fill="#ffd23f" stroke="#000000" stroke-width="14" paint-order="stroke" stroke-linejoin="round"/>
    </svg>`;
  const filepath = join(workDir, `panel-${pageNumber}-${panelIndex}.png`);
  await sharp(Buffer.from(svg)).png().toFile(filepath);
  return { path: filepath, promptChars: 0 };
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
