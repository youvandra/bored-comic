import OpenAI from "openai";
import { config } from "./config.js";
import type { GenerateComicInput, Storyboard, PageSpec } from "./types.js";

const client = new OpenAI({
  baseURL: config.sumopodBaseUrl,
  apiKey: config.sumopodApiKey,
  timeout: 90_000,
  maxRetries: 2,
});

const WRITER_PROMPT = `You are a professional comic writer and director. Create a compelling, visually rich storyboard.

STORY STRUCTURE:
- Page 1: establish the world, characters, and hook. Include a narrative caption like "The misty mountains of the East..." or "In a quiet village, far from the capital..."
- Middle pages: build tension, conflict, or comedy through action and dialogue
- Final page: deliver a satisfying payoff, plot twist, or emotional punch

NARRATION RULES:
- Each page MUST have a storyBeat that reads like a comic narration caption
- Good: "The lone warrior stepped onto the ancient bridge, unaware of the darkness that awaited..."
- Bad: "Samurai fights demon"
- Use narration to set the scene, pass time, or add dramatic weight

PANEL COMPOSITION (vary across pages):
- Establish: wide shot (setting, scale)
- Reaction: close-up (emotion, detail)
- Action: dynamic angle (impact, movement)
- Dialogue: medium shot (characters interacting)

CHARACTER DESIGN: Include age, body type, hair (color + style), eyes, distinctive clothing, and unique features. Be VISUAL — "young woman, short purple hair, goggles on forehead, worn leather jacket, cybernetic arm" not just "girl".

DIALOGUE: Keep under 30 characters per line. Punchy. Comics are visual — show emotion through expression, not exposition.
- dialogueType: "shout" for yelling/exclamations, "thought" for internal monologue, "speech" for normal talk.

SOUND EFFECTS (sfx): On high-impact action panels (hits, crashes, explosions, gunfire, magic), add a punchy onomatopoeia in ALL CAPS — "POW", "CRASH", "BOOM", "SLASH", "THWIP". Leave sfx empty on calm/dialogue panels. Do NOT overuse — at most one per page.

Output ONLY valid JSON:
{
  "title": "short, catchy",
  "synopsis": "one sentence hook",
  "characters": [{ "name", "role", "appearance": "DETAILED visual description" }],
  "pages": [{
    "page": number,
    "panels": number (2-4),
    "storyBeat": "NARRATION caption for this page, like a comic narrator's voice",
    "panelDescriptions": [{
      "panel": number,
      "scene": "VISUAL — lighting, setting, character poses, expressions, mood",
      "characters": ["names"],
      "dialogue": "short, under 30 chars (optional)",
      "dialogueType": "speech | shout | thought (optional, default speech)",
      "sfx": "onomatopoeia in CAPS for action panels only (optional)",
      "cameraAngle": "close-up | wide shot | low angle | over-shoulder (optional)"
    }]
  }]
}

GENRE GUIDES:
- Horror: shadows, dramatic lighting, tense close-ups, dread
- Comedy: exaggerated expressions, physical humor, wide reactions
- Action: dynamic poses, impact frames, speed, intensity
- Romance: soft lighting, intimate framing, lingering looks
- Manga: expressive eyes, speed lines, dramatic angles, screentone textures`;

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

  // Never fabricate duplicate pages. If the LLM returned more than asked,
  // truncate; if fewer, accept the actual count and let the delivery report it
  // honestly rather than padding with copied content.
  if (parsed.pages.length > expectedPages) {
    parsed.pages = parsed.pages.slice(0, expectedPages);
  }

  // Renumber pages sequentially so downstream page indices stay consistent.
  parsed.pages.forEach((p, i) => {
    p.page = i + 1;
  });

  return parsed;
}
