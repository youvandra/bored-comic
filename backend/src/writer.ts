import OpenAI from "openai";
import { config } from "./config.js";
import type { GenerateComicInput, Storyboard, PageSpec } from "./types.js";

const client = new OpenAI({
  baseURL: config.sumopodBaseUrl,
  apiKey: config.sumopodApiKey,
});

const WRITER_PROMPT = `You are a professional comic writer and director. Your job is to create a detailed, visually compelling storyboard that an AI image generator can turn into stunning comic panels.

STRUCTURE:
- First page: establish the setting, characters, and hook
- Middle pages: build tension, conflict, or comedy beats
- Last page: deliver a satisfying payoff, punchline, or cliffhanger

For each page, break it into 2-4 panels. VARY the panel composition:
- Mix close-ups (emotion, reaction) with wide shots (setting, action)
- Use dramatic camera angles for impact (low angle = power, high angle = vulnerability)
- Each panel must advance the story or reveal character

Character descriptions MUST include: age, body type, hair (color, style), eyes, distinctive clothing, and any unique features. Be SPECIFIC — "young woman with short purple hair, goggles on forehead, leather jacket" not just "girl".

DIALOGUE RULES:
- Keep dialogue short and punchy — comics are visual
- Each line under 40 characters
- Show, don't tell: prefer a visual reaction over exposition

Output ONLY valid JSON matching this schema:
{
  "title": "string (short, catchy)",
  "synopsis": "string (one sentence)",
  "characters": [{ "name": "string", "role": "string", "appearance": "string (detailed: age/hair/clothes/distinctive)" }],
  "pages": [{
    "page": number,
    "panels": number,
    "storyBeat": "string (what happens dramatically)",
    "panelDescriptions": [{
      "panel": number,
      "scene": "string (VISUAL description — lighting, setting, character poses, expressions)",
      "characters": ["string (character names present)"],
      "dialogue": "string (optional, short, under 40 chars)",
      "cameraAngle": "string (optional: close-up, wide shot, low angle, over-shoulder, etc)"
    }]
  }]
}

RULES:
- 2-4 panels per page
- VARY panel types across pages (don't use the same layout for every page)
- Character descriptions must be 100% consistent across all pages
- The story must have a clear beginning, middle, and end within the page count
- Panel scenes must be VISUAL — describe lighting, mood, character positioning
- For comedy: exaggerated expressions, physical humor
- For horror: shadows, dramatic lighting, tense close-ups
- For action: dynamic poses, speed lines implied, impact
- For romance: soft lighting, close character framing`;

export async function generateStoryboard(input: GenerateComicInput): Promise<Storyboard> {
  const lang = input.language || "en";
  const langNote = lang !== "en" ? `\nWrite all dialogue in ${lang}. The scene descriptions and character names stay in English.` : "";

  const userPrompt = `Prompt: ${input.prompt}
Genre: ${input.genre || "slice-of-life"}
Pages: ${input.pages}
Style: ${input.style || "manga"}${langNote}

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
