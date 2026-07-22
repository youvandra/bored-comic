import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runPipeline, revisePage } from "./pipeline.js";
import { createCharacter } from "./character.js";
import { collectionCount, getCharacter, getJob, getSeries, getViews, MAX_COLLECTION_SIZE, newId, saveSeries } from "./store.js";
import { config } from "./config.js";
import fs from "node:fs";
import path from "node:path";
import { GenerateComicInput, MIN_PAGES } from "./types.js";
import { x402Info } from "./x402.js";

const GENRES = ["horror", "romance", "action", "comedy", "manga", "fantasy", "sci-fi", "slice-of-life"] as const;
const STYLES = ["manga", "western", "semi-realistic", "chibi"] as const;
const ASPECTS = ["3:4", "9:16", "1:1"] as const;
const LAYOUT_MODES = ["page", "webtoon"] as const;

export type Inflight = { kind: "generate" | "revise"; stage: string; startedAt: number; pages: number; error?: string };
// Shared with the x402-native handler so get_job polling works for jobs it
// runs in the background (long/premium comics returned async).
export const inflight = new Map<string, Inflight>();

export function etaSeconds(pages: number): number {
  return 45 + pages * 40;
}

function jsonResult(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

// ─── Free tools shared by all MCP servers ───────────────────────────────────

function registerFreeTools(server: McpServer): void {
  server.registerTool(
    "clarify_comic",
    {
      title: "Clarify comic parameters",
      annotations: { readOnlyHint: true },
      description:
        "Free tool: given a partial or vague comic request, returns structured clarification questions the agent can ask the user. Use this before generate_comic when the user's request is missing page count, prompt, or other key fields. This tool is always free.",
      inputSchema: {
        prompt: z.string().optional().describe("Partial or empty prompt"),
        genre: z.enum(GENRES).optional().describe("Genre hint"),
        pages: z.number().int().min(1).optional().describe("Page count hint"),
        style: z.enum(STYLES).optional().describe("Style hint"),
        language: z.string().min(2).max(10).optional().describe("Language hint"),
        colorMode: z.enum(["color", "bw"]).optional().describe("Color mode hint"),
        layoutMode: z.enum(LAYOUT_MODES).optional().describe("Layout hint: classic pages or vertical webtoon"),
      },
    },
    async (input) => {
      const questions: string[] = [];
      const missing: string[] = [];
      const suggestions: Record<string, string[]> = {};

      if (!input.prompt || input.prompt.length < 3) {
        missing.push("prompt");
        questions.push("What should the comic be about? (e.g. 'a cat astronaut exploring Mars')");
      }

      if (!input.pages) {
        missing.push("pages");
        questions.push("How many pages? (1-20 depending on your endpoint)");
      }

      if (!input.genre) {
        suggestions.genre = [...GENRES] as string[];
        questions.push("What genre? Options: " + GENRES.join(", "));
      }

      if (!input.style) {
        suggestions.style = [...STYLES] as string[];
        questions.push("What art style? Options: " + STYLES.join(", ") + " (default: manga)");
      }

      if (!input.language) {
        questions.push("What language for dialogue? (default: en)");
      }

      if (!input.colorMode) {
        suggestions.colorMode = ["color", "bw"];
        questions.push("Color or black & white? (default: color)");
      }

      if (!input.layoutMode) {
        suggestions.layoutMode = [...LAYOUT_MODES] as string[];
        questions.push("Classic comic pages or vertical webtoon strip? (default: page)");
      }

      return jsonResult({
        clarify: true,
        missing: missing.length > 0 ? missing : undefined,
        questions,
        suggestions: Object.keys(suggestions).length > 0 ? suggestions : undefined,
        passed: input,
        defaults: { style: "manga", aspectRatio: "3:4", language: "en", colorMode: "color", layoutMode: "page" },
        tips: [
          "Register recurring characters with create_character and pass characterIds for consistent appearance across comics.",
          "Start a series with create_series and pass seriesId — each new comic continues from the previous episode's ending.",
        ],
      });
    },
  );

  server.registerTool(
    "get_job",
    {
      title: "Re-fetch a delivered comic",
      annotations: { readOnlyHint: true },
      description:
        "Free tool: poll generation progress and fetch the full delivery payload of a comic by jobId. While the job is running it returns { status, stage, etaSeconds } — poll every ~15 seconds. Once finished it returns the complete delivery, fetchable for 7 days. Note: the metadata outlives the files; comic images/PDF expire from disk after 24h.",
      inputSchema: {
        jobId: z.string().describe("Job ID returned by generate_comic"),
      },
    },
    async (input) => {
      const fly = inflight.get(input.jobId);
      if (fly) {
        if (fly.error) {
          return jsonResult({ jobId: input.jobId, status: "failed", error: fly.error }, true);
        }
        const elapsed = Math.round((Date.now() - fly.startedAt) / 1000);
        return jsonResult({
          jobId: input.jobId,
          status: fly.kind === "revise" ? "revising" : "generating",
          stage: fly.stage,
          elapsedSeconds: elapsed,
          etaSeconds: Math.max(10, etaSeconds(fly.pages) - elapsed),
          next: "Not done yet — poll get_job again in ~15 seconds.",
        });
      }
      const job = getJob(input.jobId);
      if (!job || !job.delivery) {
        return jsonResult({ error: `Unknown or expired jobId: ${input.jobId}. Deliveries stay fetchable for 7 days.` }, true);
      }
      const filesOnDisk = fs.existsSync(path.join(config.comicDir, input.jobId, "cover.png"));
      return jsonResult({
        ...job.delivery,
        views: getViews(input.jobId),
        filesAvailable: filesOnDisk,
        ...(filesOnDisk ? {} : { filesNote: "Comic files have expired from storage (24h TTL). Metadata and integrity hashes remain valid; regenerate to get new files." }),
      });
    },
  );

  server.registerTool(
    "get_character",
    {
      title: "Get a registered character",
      annotations: { readOnlyHint: true },
      description: "Free tool: look up a registered character by ID — canonical appearance, style, reference sheet URL. Always free.",
      inputSchema: {
        characterId: z.string().describe("Character ID from create_character"),
      },
    },
    async (input) => {
      const character = getCharacter(input.characterId);
      if (!character) return jsonResult({ error: `Unknown characterId: ${input.characterId}` }, true);
      return jsonResult(character);
    },
  );

  server.registerTool(
    "create_series",
    {
      title: "Start a comic series",
      annotations: { readOnlyHint: false },
      description:
        "Free tool: create a series container. Pass the returned seriesId to generate_comic and every new comic becomes the next episode, continuing the story from the previous episode's ending. Optionally set default genre/style/language/colorMode and a fixed cast of registered characterIds that star in every episode.",
      inputSchema: {
        title: z.string().min(1).max(120).describe("Series title"),
        genre: z.enum(GENRES).optional().describe("Default genre for episodes"),
        style: z.enum(STYLES).optional().describe("Default art style for episodes"),
        language: z.string().min(2).max(10).optional().describe("Default dialogue language"),
        colorMode: z.enum(["color", "bw"]).optional().describe("Default color mode"),
        characterIds: z.array(z.string()).max(6).optional().describe("Registered characters that star in every episode"),
      },
    },
    async (input) => {
      const missing = (input.characterIds ?? []).filter((id) => !getCharacter(id));
      if (missing.length > 0) {
        return jsonResult({ error: `Unknown characterId(s): ${missing.join(", ")}` }, true);
      }
      if (collectionCount("series") >= MAX_COLLECTION_SIZE) {
        return jsonResult({ error: "Series store is at capacity. Contact the operator." }, true);
      }
      const now = new Date().toISOString();
      const series = {
        seriesId: newId("sr"),
        title: input.title,
        genre: input.genre,
        style: input.style,
        language: input.language,
        colorMode: input.colorMode,
        characterIds: input.characterIds ?? [],
        episodes: [],
        createdAt: now,
        updatedAt: now,
      };
      saveSeries(series);
      return jsonResult({
        ...series,
        usage: `Pass seriesId: "${series.seriesId}" to generate_comic — each call becomes the next episode.`,
      });
    },
  );

  server.registerTool(
    "get_series",
    {
      title: "Get a series",
      annotations: { readOnlyHint: true },
      description:
        "Free tool: look up a series by ID — defaults, fixed cast, and the full episode history with per-episode ending summaries AND reader view counts. Views come from the hosted web reader (readerUrl in every delivery): share the link, then read back which episodes your audience actually opened, and write the next one accordingly. Always free.",
      inputSchema: {
        seriesId: z.string().describe("Series ID from create_series"),
      },
    },
    async (input) => {
      const series = getSeries(input.seriesId);
      if (!series) return jsonResult({ error: `Unknown seriesId: ${input.seriesId}` }, true);
      return jsonResult({
        ...series,
        episodes: series.episodes.map((e) => ({ ...e, views: getViews(e.jobId) })),
        totalViews: series.episodes.reduce((s, e) => s + getViews(e.jobId), 0),
      });
    },
  );
}

// ─── Gen server: only generate_comic + free tools ───────────────────────────

export function buildGenServer(maxPages: number, tierPrice: string, tierName: string): McpServer {
  const server = new McpServer(
    { name: `BoredComic ${tierName}`, version: "0.2.0" },
    {
      instructions:
        `BoredComic ${tierName} — AI comic generator for ${getPageRange(maxPages)} comics. ` +
        `Paid tool — generate_comic ($${tierPrice}): prompt in, jobId out immediately; generation runs in the background (typically 1-4 minutes); poll the free get_job tool to fetch the finished delivery. ` +
        `Free tools: clarify_comic, create/get_series, get_character, get_job, get_quota.`,
    },
  );

  server.registerTool(
    "generate_comic",
    {
      title: "Generate comic",
      annotations: { readOnlyHint: false, openWorldHint: true },
      description:
        `Generate a complete comic (${getPageRange(maxPages)}) from a natural-language prompt. Returns a jobId immediately; generation runs in the background (typically 1-4 minutes) — poll the free get_job tool with the jobId to fetch the finished delivery: per-page images, per-panel images with alt text, a combined PDF, a CBZ archive, a shareable hosted reader link (readerUrl — send this to humans; link previews show the cover), a vision-model quality report grading every page (evidence.qualityReport), structured metadata (characters, panel count, story arc), SHA-256 integrity hashes, a signed delivery receipt, and an explicit commercial-use license. Pass characterIds (from create_character) to star registered characters with consistent appearance. Pass seriesId (from create_series) to continue an ongoing story. layoutMode 'webtoon' produces a vertical-scroll strip.`,
      inputSchema: {
        prompt: z.string().min(3).describe("What the comic should be about"),
        genre: z.enum(GENRES).optional().describe("Genre of the comic"),
        pages: z.number().int().min(MIN_PAGES).max(maxPages).describe(`Number of pages (${MIN_PAGES}-${maxPages})`),
        style: z.enum(STYLES).optional().describe("Art style (default: manga)"),
        aspectRatio: z.enum(ASPECTS).optional().describe("Page aspect ratio (default: 3:4; ignored in webtoon mode)"),
        language: z.string().min(2).max(10).optional().describe("Language for dialogue (default: en)"),
        colorMode: z.enum(["color", "bw"]).optional().describe("Color or black & white (default: color)"),
        layoutMode: z.enum(LAYOUT_MODES).optional().describe("'page' for classic comic pages, 'webtoon' for a vertical-scroll strip (default: page)"),
        characterIds: z.array(z.string()).max(6).optional().describe("Registered character IDs (from create_character) that must star in this comic"),
        seriesId: z.string().optional().describe("Series ID (from create_series) — the story continues from the previous episode's ending"),
      },
    },
    async (input) => {
      const jobId = `cg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const gen = input as GenerateComicInput;

      inflight.set(jobId, { kind: "generate", stage: "queued", startedAt: Date.now(), pages: gen.pages });
      void runPipeline(jobId, gen, {
        setStatus: (stage) => {
          const j = inflight.get(jobId);
          if (j) j.stage = stage;
        },
      })
        .then(() => { inflight.delete(jobId); })
        .catch((err) => {
          console.error(`generate_comic pipeline failed for ${jobId}:`, err);
          const j = inflight.get(jobId);
          if (j) j.error = err instanceof Error ? err.message : "Generation failed";
        });

      return jsonResult({
        jobId,
        status: "generating",
        stage: "queued",
        etaSeconds: etaSeconds(gen.pages),
        next: "Poll the free get_job tool with this jobId every ~15 seconds until it returns the full delivery.",
      });
    },
  );

  server.registerTool(
    "get_quota",
    {
      title: "Check pricing",
      annotations: { readOnlyHint: true },
      description: `Free billing introspection: shows the ${tierName} price of $${tierPrice} per comic.`,
      inputSchema: {},
    },
    async () => jsonResult(x402Info(tierPrice)),
  );

  registerFreeTools(server);
  return server;
}

// ─── Tools server: revise_page, create_character + free tools ──────────────

export function buildToolsServer(basePrice: string): McpServer {
  const server = new McpServer(
    { name: "BoredComic Tools", version: "0.2.0" },
    {
      instructions:
        `BoredComic Tools — paid tools: revise_page ($${basePrice}) and create_character ($${basePrice}). ` +
        `revise_page: change one page of a delivered comic without regenerating the whole comic — also async; poll get_job for updated delivery. ` +
        `create_character: register a character once with canonical appearance + stable seed + reference sheet, reuse across comics. ` +
        `Free tools: clarify_comic, create/get_series, get_character, get_job, get_quota. ` +
        `Note: this endpoint does NOT generate new comics. Use /gen/basic, /gen/standard, or /gen/premium for that.`,
    },
  );

  server.registerTool(
    "revise_page",
    {
      title: "Revise one page",
      annotations: { readOnlyHint: false, openWorldHint: true },
      description:
        `Revise a single page of a previously generated comic without regenerating the whole comic: change dialogue, redraw a panel, shift the mood. The page is rewritten per your instruction and re-rendered with the job's original seed and cast, and the PDF/CBZ are rebuilt when possible. Returns immediately; poll the free get_job tool for the updated delivery. Jobs stay revisable for 7 days. Priced at $${basePrice}.`,
      inputSchema: {
        jobId: z.string().describe("Job ID returned by generate_comic"),
        page: z.number().int().min(1).describe("Page number to revise"),
        instruction: z.string().min(3).describe("What to change, e.g. 'make panel 2 a dramatic close-up' or 'rewrite the dialogue to be funnier'"),
      },
    },
    async (input) => {
      const { jobId } = input;
      if (inflight.has(jobId)) {
        return jsonResult({ error: `Job ${jobId} is still generating — poll get_job first.`, jobId }, true);
      }
      if (!getJob(jobId)) {
        return jsonResult({ error: `Unknown or expired jobId: ${jobId}.`, jobId }, true);
      }
      inflight.set(jobId, { kind: "revise", stage: "queued", startedAt: Date.now(), pages: 1 });
      void revisePage(jobId, input.page, input.instruction, {
        setStatus: (stage) => {
          const j = inflight.get(jobId);
          if (j) j.stage = stage;
        },
      })
        .then(() => { inflight.delete(jobId); })
        .catch((err) => {
          console.error(`revise_page pipeline failed for ${jobId}:`, err);
          const j = inflight.get(jobId);
          if (j) j.error = err instanceof Error ? err.message : "Revision failed";
        });

      return jsonResult({
        jobId,
        status: "revising",
        stage: "queued",
        etaSeconds: etaSeconds(1),
        next: "Poll the free get_job tool with this jobId until the updated delivery appears.",
      });
    },
  );

  server.registerTool(
    "create_character",
    {
      title: "Register a persistent character",
      annotations: { readOnlyHint: false, openWorldHint: true },
      description:
        `Register a character once at $${basePrice}, reuse it forever: stores a canonical appearance and a stable generation seed, and renders a reference character sheet. Pass the returned characterId to generate_comic (characterIds) so the character appears with consistent design across every comic and series episode. Appearance must be a detailed VISUAL description (age, hair, eyes, clothing, distinctive features).`,
      inputSchema: {
        name: z.string().min(1).max(60).describe("Character name"),
        role: z.string().max(80).optional().describe("Role, e.g. 'protagonist', 'rival', 'mentor'"),
        appearance: z.string().min(20).max(600).describe("Detailed visual description: age, body type, hair color + style, eyes, clothing, unique features"),
        style: z.enum(STYLES).optional().describe("Art style for the reference sheet (default: manga)"),
      },
    },
    async (input) => {
      try {
        const character = await createCharacter(input);
        return jsonResult({
          ...character,
          usage: `Pass characterIds: ["${character.characterId}"] to generate_comic to star this character.`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Character registration failed";
        return jsonResult({ error: msg }, true);
      }
    },
  );

  server.registerTool(
    "get_quota",
    {
      title: "Check pricing",
      annotations: { readOnlyHint: true },
      description: `Free billing introspection: shows BoredComic Tools pricing — revise_page and create_character at $${basePrice} each.`,
      inputSchema: {},
    },
    async () => jsonResult(x402Info(basePrice)),
  );

  registerFreeTools(server);
  return server;
}

// ─── Helper ─────────────────────────────────────────────────────────────────

function getPageRange(maxPages: number): string {
  if (maxPages <= 5) return `1-${maxPages} pages`;
  if (maxPages <= 10) return `6-${maxPages} pages`;
  return `11-${maxPages} pages`;
}
