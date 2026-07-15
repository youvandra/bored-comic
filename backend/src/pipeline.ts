import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { config } from "./config.js";
import type { ComicDelivery, ComicEvidence, GenerateComicInput, PageResult, Storyboard } from "./types.js";
import { generateStoryboard } from "./writer.js";
import { generatePanel, type ImageGenResult } from "./illustrator.js";
import { buildPdf } from "./assembler.js";

export interface PipelineHooks {
  setStatus(status: string): void;
}

export async function runPipeline(
  jobId: string,
  input: GenerateComicInput,
  hooks: PipelineHooks,
): Promise<ComicDelivery> {
  const workDir = join(config.comicDir, jobId);
  await mkdir(workDir, { recursive: true });
  const startTime = Date.now();

  hooks.setStatus("writing");
  const storyboard = await generateStoryboard(input);

  hooks.setStatus("illustrating");
  const totalPanels = storyboard.pages.reduce((s, p) => s + p.panels, 0);
  const pageResults: PageResult[] = [];
  let totalPromptChars = 0;

  for (const page of storyboard.pages) {
    const panelPromises = page.panelDescriptions.map((pd, i) =>
      generatePanel({
        prompt: buildPanelPrompt(pd, storyboard.characters, input.style || "manga"),
        pageNumber: page.page,
        panelIndex: i,
        workDir,
        jobId,
      }),
    );

    const panelImages = await Promise.all(panelPromises);

    const assembled = await assemblePage({
      panels: panelImages,
      pageNumber: page.page,
      workDir,
      jobId,
      aspectRatio: input.aspectRatio || "3:4",
    });

    const promptChars = panelPromises.length > 0
      ? panelImages.reduce((s, p) => s + p.promptChars, 0)
      : 0;
    totalPromptChars += promptChars;

    pageResults.push({
      page: page.page,
      panels: page.panels,
      storyBeat: page.storyBeat,
      imageUrl: `/comics/${jobId}/page-${page.page}.png`,
      evidence: {
        model: "black-forest-labs/flux-2-pro",
        promptChars,
        characterCount: page.panelDescriptions.reduce(
          (s, pd) => Math.max(s, pd.characters.length),
          0,
        ),
        caveat: "Generated from text prompt — character appearance may vary slightly across pages.",
      },
    });
  }

  hooks.setStatus("assembling");
  const pdfUrl = await buildPdf(pageResults, workDir, jobId);

  const elapsedSec = Math.round((Date.now() - startTime) / 1000);
  const costEstimate = estimateCost(input.pages, totalPanels);

  const evidence: ComicEvidence = {
    model: "black-forest-labs/flux-2-pro",
    pagesGenerated: input.pages,
    panelsGenerated: totalPanels,
    generationTimeSec: elapsedSec,
    costEstimateUsd: costEstimate,
    caveat: "Comic is AI-generated. Story coherence and visual consistency are heuristic, not guaranteed.",
  };

  const summary = `${input.pages}-page ${input.genre || "story"} ${input.style || "manga"} '${storyboard.title}': ${totalPanels} panels, ${storyboard.characters.length} characters. Generated in ${elapsedSec}s.`;

  return {
    jobId,
    summary,
    title: storyboard.title,
    pages: input.pages,
    totalPanels,
    style: input.style || "manga",
    genre: input.genre || "slice-of-life",
    characters: storyboard.characters,
    pageUrls: pageResults.map((p) => p.imageUrl),
    pdfUrl,
    perPage: pageResults,
    evidence,
  };
}

function buildPanelPrompt(
  pd: import("./types.js").PanelDescription,
  characters: import("./types.js").Character[],
  style: string,
): string {
  const charRefs = pd.characters
    .map((name) => {
      const c = characters.find((ch) => ch.name === name);
      return c ? `${c.name}: ${c.appearance}` : name;
    })
    .join("; ");

  return `${style} style. ${pd.scene}. Characters present: ${charRefs}.${pd.dialogue ? ` Dialogue: ${pd.dialogue}` : ""}${pd.cameraAngle ? ` Camera: ${pd.cameraAngle}.` : ""} Comic panel, consistent with previous panels.`;
}

async function assemblePage(params: {
  panels: ImageGenResult[];
  pageNumber: number;
  workDir: string;
  jobId: string;
  aspectRatio: string;
}): Promise<string> {
  const { panels, pageNumber, workDir } = params;
  if (panels.length === 0) return "";
  if (panels.length === 1) return panels[0].path;

  const cols = Math.min(2, panels.length);
  const rows = Math.ceil(panels.length / cols);
  const gap = 10;
  const panelW = 400;
  const panelH = 500;

  const composite = panels.map((p, i) => ({
    input: p.path,
    top: Math.floor(i / cols) * (panelH + gap),
    left: (i % cols) * (panelW + gap),
  }));

  const totalW = cols * (panelW + gap) - gap;
  const totalH = rows * (panelH + gap) - gap;

  const outputPath = join(workDir, `page-${pageNumber}.png`);
  await sharp({
    create: {
      width: totalW,
      height: totalH,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite(composite)
    .png()
    .toFile(outputPath);

  return outputPath;
}

function estimateCost(pages: number, panels: number): number {
  const textCost = 0.005;
  const imageCostPerPanel = 0.003;
  return Math.round((textCost + imageCostPerPanel * panels) * 100) / 100;
}
