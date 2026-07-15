import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runPipeline } from "./pipeline.js";
import { GenerateComicInput, MAX_PAGES, MIN_PAGES } from "./types.js";
import { x402Info } from "./x402.js";

export function buildMcpServer(callerIp = "unknown"): McpServer {
  const server = new McpServer(
    { name: "BoredComic", version: "0.1.0" },
    {
      instructions:
        "BoredComic — AI comic generator. Send a prompt, genre, page count, and style; receive a complete comic PDF + per-page images + decision-grade metadata. One-shot generation, no revision loop. All tool calls are paid via x402 — no free quota. Call get_quota for pricing before your first call.",
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
        genre: z
          .enum(["horror", "romance", "action", "comedy", "manga", "fantasy", "sci-fi", "slice-of-life", "18+"])
          .optional()
          .describe("Genre of the comic"),
        pages: z
          .number()
          .int()
          .min(MIN_PAGES)
          .max(MAX_PAGES)
          .describe(`Number of pages (${MIN_PAGES}-${MAX_PAGES})`),
        style: z
          .enum(["manga", "western", "semi-realistic", "chibi"])
          .optional()
          .describe("Art style (default: manga)"),
        aspectRatio: z
          .enum(["3:4", "9:16", "1:1"])
          .optional()
          .describe("Page aspect ratio (default: 3:4)"),
        language: z
          .string()
          .min(2)
          .max(10)
          .optional()
          .describe("Language for comic dialogue (e.g. 'en', 'id', 'ja', 'zh'. Default: 'en')"),
        colorMode: z
          .enum(["color", "bw"])
          .optional()
          .describe("Color or black & white (default: color)"),
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
