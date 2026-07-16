import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runPipeline, revisePage } from "./pipeline.js";
import { createCharacter } from "./character.js";
import { collectionCount, getCharacter, getJob, getSeries, MAX_COLLECTION_SIZE, newId, saveSeries } from "./store.js";
import { config } from "./config.js";
import fs from "node:fs";
import path from "node:path";
import { GenerateComicInput, MAX_PAGES, MIN_PAGES } from "./types.js";
import { x402Info } from "./x402.js";

const GENRES = ["horror", "romance", "action", "comedy", "manga", "fantasy", "sci-fi", "slice-of-life"] as const;
const STYLES = ["manga", "western", "semi-realistic", "chibi"] as const;
const ASPECTS = ["3:4", "9:16", "1:1"] as const;
const LAYOUT_MODES = ["page", "webtoon"] as const;

function jsonResult(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

export function buildMcpServer(callerIp = "unknown"): McpServer {
  const server = new McpServer(
    { name: "BoredComic", version: "0.2.0" },
    {
      instructions:
        "BoredComic — AI comic generator with persistent characters and series. " +
        "generate_comic (paid): prompt in, complete comic out — per-page images, per-panel images with alt text, PDF, CBZ, webtoon strip, plus decision-grade metadata, SHA-256 integrity hashes, a signed delivery receipt, and an explicit commercial license. " +
        "create_character (paid): register a character once — canonical appearance + stable seed + reference sheet — then reuse it across comics via characterIds for consistent appearance. " +
        "create_series (free): start a series; each generate_comic with the seriesId continues the story from the previous episode's ending. " +
        "revise_page (paid): change one page of a delivered comic ('make panel 2 more dramatic', 'change the dialogue') without regenerating the whole comic. " +
        "get_job (free): re-fetch the full delivery of a paid comic by jobId — the recovery path if your connection dropped mid-generation. " +
        "clarify_comic and get_quota are always free. Payment is per-call via x402.",
    },
  );

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
        pages: z.number().int().min(1).max(MAX_PAGES).optional().describe("Page count hint"),
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
        questions.push("How many pages? (1-10)");
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
    "generate_comic",
    {
      title: "Generate comic",
      annotations: { readOnlyHint: false, openWorldHint: true },
      description:
        "Generate a complete comic from a natural-language prompt. Returns per-page images, per-panel images with alt text, a combined PDF, a CBZ archive, structured metadata (characters, panel count, story arc), SHA-256 integrity hashes, a signed delivery receipt, and an explicit commercial-use license. Pass characterIds (from create_character) to star registered characters with consistent appearance. Pass seriesId (from create_series) to continue an ongoing story. layoutMode 'webtoon' produces a vertical-scroll strip.",
      inputSchema: {
        prompt: z.string().min(3).describe("What the comic should be about"),
        genre: z.enum(GENRES).optional().describe("Genre of the comic"),
        pages: z.number().int().min(MIN_PAGES).max(MAX_PAGES).describe(`Number of pages (${MIN_PAGES}-${MAX_PAGES})`),
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

      try {
        const delivery = await runPipeline(jobId, input as GenerateComicInput, {
          setStatus: () => {},
        });
        return jsonResult(delivery);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Generation failed";
        return jsonResult({ error: msg, jobId }, true);
      }
    },
  );

  server.registerTool(
    "revise_page",
    {
      title: "Revise one page",
      annotations: { readOnlyHint: false, openWorldHint: true },
      description:
        "Revise a single page of a previously generated comic without regenerating the whole comic: change dialogue, redraw a panel, shift the mood. The page is rewritten per your instruction and re-rendered with the job's original seed and cast, and the PDF/CBZ are rebuilt when possible. Jobs stay revisable for 7 days. Priced at the base rate regardless of the comic's size.",
      inputSchema: {
        jobId: z.string().describe("Job ID returned by generate_comic"),
        page: z.number().int().min(1).max(MAX_PAGES).describe("Page number to revise"),
        instruction: z.string().min(3).describe("What to change, e.g. 'make panel 2 a dramatic close-up' or 'rewrite the dialogue to be funnier'"),
      },
    },
    async (input) => {
      try {
        const revision = await revisePage(input.jobId, input.page, input.instruction, { setStatus: () => {} });
        return jsonResult(revision);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Revision failed";
        return jsonResult({ error: msg, jobId: input.jobId }, true);
      }
    },
  );

  server.registerTool(
    "create_character",
    {
      title: "Register a persistent character",
      annotations: { readOnlyHint: false, openWorldHint: true },
      description:
        "Register a character once, reuse it forever: stores a canonical appearance and a stable generation seed, and renders a reference character sheet. Pass the returned characterId to generate_comic (characterIds) so the character appears with consistent design across every comic and series episode. Appearance must be a detailed VISUAL description (age, hair, eyes, clothing, distinctive features).",
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
    "get_job",
    {
      title: "Re-fetch a delivered comic",
      annotations: { readOnlyHint: true },
      description:
        "Free tool: fetch the full delivery payload of a previously generated comic by jobId. This is the recovery path when a paid generate_comic response was lost to a connection drop or timeout — you paid once, the result stays fetchable for 7 days. Note: the metadata outlives the files; comic images/PDF expire from disk after 24h.",
      inputSchema: {
        jobId: z.string().describe("Job ID returned by generate_comic"),
      },
    },
    async (input) => {
      const job = getJob(input.jobId);
      if (!job || !job.delivery) {
        return jsonResult({ error: `Unknown or expired jobId: ${input.jobId}. Deliveries stay fetchable for 7 days.` }, true);
      }
      // Files expire on a shorter TTL than the job record — tell the agent
      // whether the URLs in this payload are still downloadable.
      const filesOnDisk = fs.existsSync(path.join(config.comicDir, input.jobId, "cover.png"));
      return jsonResult({
        ...job.delivery,
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
      description: "Free tool: look up a series by ID — defaults, fixed cast, and the full episode history with per-episode ending summaries. Always free.",
      inputSchema: {
        seriesId: z.string().describe("Series ID from create_series"),
      },
    },
    async (input) => {
      const series = getSeries(input.seriesId);
      if (!series) return jsonResult({ error: `Unknown seriesId: ${input.seriesId}` }, true);
      return jsonResult(series);
    },
  );

  server.registerTool(
    "get_quota",
    {
      title: "Check pricing",
      annotations: { readOnlyHint: true },
      description:
        "Free billing introspection: returns current x402 pricing (per tool), payment address, and whether the gate is enabled. This tool is always free.",
      inputSchema: {},
    },
    async () => {
      return jsonResult(x402Info());
    },
  );

  return server;
}
