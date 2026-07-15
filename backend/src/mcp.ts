import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runPipeline } from "./pipeline.js";
import { GenerateComicInput, MAX_PAGES, MIN_PAGES } from "./types.js";
import { x402Info } from "./x402.js";

const GENRES = ["horror", "romance", "action", "comedy", "manga", "fantasy", "sci-fi", "slice-of-life", "18+"] as const;
const STYLES = ["manga", "western", "semi-realistic", "chibi"] as const;
const ASPECTS = ["3:4", "9:16", "1:1"] as const;

export function buildMcpServer(callerIp = "unknown"): McpServer {
  const server = new McpServer(
    { name: "BoredComic", version: "0.1.0" },
    {
      instructions:
        "BoredComic — AI comic generator. Send a prompt, genre, page count, and style; receive a complete comic PDF + per-page images + decision-grade metadata. One-shot generation, no revision loop. All tool calls are paid via x402 — no free quota. Use clarify_comic (free) first if you need help filling in the parameters.",
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

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            clarify: true,
            missing: missing.length > 0 ? missing : undefined,
            questions,
            suggestions: Object.keys(suggestions).length > 0 ? suggestions : undefined,
            passed: input,
            defaults: { style: "manga", aspectRatio: "3:4", language: "en", colorMode: "color" },
          }, null, 2),
        }],
      };
    },
  );

  server.registerTool(
    "generate_comic",
    {
      title: "Generate comic",
      annotations: { readOnlyHint: true },
      description:
        "Generate a complete comic from a natural-language prompt. Returns per-page images, a combined PDF, and structured metadata (characters, panel count, story arc) an agent can evaluate without reading the comic. Supports dynamic layouts, multi-language, color or black & white.",
      inputSchema: {
        prompt: z.string().min(3).describe("What the comic should be about"),
        genre: z.enum(GENRES).optional().describe("Genre of the comic"),
        pages: z.number().int().min(MIN_PAGES).max(MAX_PAGES).describe(`Number of pages (${MIN_PAGES}-${MAX_PAGES})`),
        style: z.enum(STYLES).optional().describe("Art style (default: manga)"),
        aspectRatio: z.enum(ASPECTS).optional().describe("Page aspect ratio (default: 3:4)"),
        language: z.string().min(2).max(10).optional().describe("Language for dialogue (default: en)"),
        colorMode: z.enum(["color", "bw"]).optional().describe("Color or black & white (default: color)"),
      },
    },
    async (input) => {
      const jobId = `cg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      try {
        const delivery = await runPipeline(jobId, input as GenerateComicInput, {
          setStatus: () => {},
        });

        return {
          content: [{ type: "text", text: JSON.stringify(delivery, null, 2) }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Generation failed";
        return {
          content: [{ type: "text", text: JSON.stringify({ error: msg, jobId }, null, 2) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get_quota",
    {
      title: "Check pricing",
      annotations: { readOnlyHint: true },
      description:
        "Free billing introspection: returns current x402 pricing, payment address, and whether the gate is enabled. This tool is always free.",
      inputSchema: {},
    },
    async () => {
      return {
        content: [{ type: "text", text: JSON.stringify(x402Info(), null, 2) }],
      };
    },
  );

  return server;
}
