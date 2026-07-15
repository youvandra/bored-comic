import OpenAI from "openai";
import { config } from "./config.js";
import type { GenerateComicInput, Storyboard, PageSpec } from "./types.js";

const client = new OpenAI({
  baseURL: config.sumopodBaseUrl,
  apiKey: config.sumopodApiKey,
});

const WRITER_PROMPT = `You are a comic writer. Given a user's prompt, genre, page count, and style, output a structured storyboard as JSON.

For each page, break it into 2-4 panels. Each panel must describe the scene, which characters are present, optional dialogue, and camera angle.

Character descriptions must be detailed (age, hair, clothes, distinguishing features) so an image generator can keep them consistent across pages.

Output ONLY valid JSON matching this schema:
{
  "title": "string",
  "synopsis": "string",
  "characters": [{ "name": "string", "role": "string", "appearance": "string" }],
  "pages": [{
    "page": number,
    "panels": number,
    "storyBeat": "string",
    "panelDescriptions": [{
      "panel": number,
      "scene": "string",
      "characters": ["string"],
      "dialogue": "string (optional)",
      "cameraAngle": "string (optional)"
    }]
  }]
}

Rules:
- 2-4 panels per page
- Keep character descriptions consistent across all pages
- The story must have a beginning, middle, and end within the page count
- Panel descriptions should be visual enough for an image generator to render`;

export async function generateStoryboard(input: GenerateComicInput): Promise<Storyboard> {
  const userPrompt = `Prompt: ${input.prompt}
Genre: ${input.genre || "slice-of-life"}
Pages: ${input.pages}
Style: ${input.style || "manga"}

Create a ${input.pages}-page ${input.genre || "story"} in ${input.style || "manga"} style with a full story arc.`;

  const response = await client.chat.completions.create({
    model: config.sumopodModel,
    messages: [
      { role: "system", content: WRITER_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.9,
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("Writer returned empty response");

  return parseStoryboard(text, input.pages);
}

export function parseStoryboard(json: string, expectedPages: number): Storyboard {
  const parsed = JSON.parse(json) as Storyboard;

  if (!parsed.title || !parsed.pages || parsed.pages.length === 0) {
    throw new Error("Writer returned invalid storyboard: missing title or pages");
  }

  if (parsed.pages.length !== expectedPages) {
    parsed.pages = parsed.pages.slice(0, expectedPages);
    while (parsed.pages.length < expectedPages) {
      const last = parsed.pages[parsed.pages.length - 1];
      if (last) {
        parsed.pages.push({
          page: parsed.pages.length + 1,
          panels: last.panels,
          storyBeat: "Continuation...",
          panelDescriptions: last.panelDescriptions.map((pd) => ({
            ...pd,
            scene: pd.scene,
          })),
        });
      }
    }
  }

  return parsed;
}
