import OpenAI from "openai";
import { config } from "./config.js";
import type { Character, GenerateComicInput, Storyboard, PageSpec } from "./types.js";

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
  "endingSummary": "1-2 sentences: where the story ends, what changed, any open thread",
  "characters": [{ "name", "role", "appearance": "DETAILED visual description" }],
  "pages": [{
    "page": number,
    "panels": number (2-4),
    "storyBeat": "NARRATION caption for this page, like a comic narrator's voice",
    "panelDescriptions": [{
      "panel": number,
      "scene": "VISUAL — lighting, setting, character poses, expressions, mood",
      "characters": ["names"],
      "dialogue": "first speaker's line, under 30 chars (optional)",
      "dialogueType": "speech | shout | thought (optional, default speech)",
      "dialogue2": "second speaker's REPLY, under 30 chars — ONLY when two characters talk in the same panel (optional)",
      "dialogue2Type": "speech | shout | thought (optional)",
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

export interface SeriesContext {
  seriesTitle: string;
  episodes: { episode: number; title: string; endingSummary: string }[];
}

export interface StoryboardOptions {
  // Registered characters that MUST appear with this exact appearance text.
  fixedCharacters?: Character[];
  // Prior episodes — the new story continues from the last ending.
  seriesContext?: SeriesContext;
}

export async function generateStoryboard(input: GenerateComicInput, opts: StoryboardOptions = {}): Promise<Storyboard> {
  const lang = input.language || "en";
  const langNote = lang !== "en" ? `\nWrite all dialogue in ${lang}. The scene descriptions and character names stay in English.` : "";

  let castNote = "";
  if (opts.fixedCharacters && opts.fixedCharacters.length > 0) {
    const cast = opts.fixedCharacters
      .map((c) => `- ${c.name} (${c.role}): ${c.appearance}`)
      .join("\n");
    castNote = `\n\nFIXED CAST — these characters already exist. They MUST appear in the story. Copy their appearance text VERBATIM into the characters array — do not rewrite, shorten, or restyle it. You may invent at most 2 additional side characters.\n${cast}`;
  }

  let seriesNote = "";
  if (opts.seriesContext && opts.seriesContext.episodes.length > 0) {
    const history = opts.seriesContext.episodes
      .map((e) => `- Episode ${e.episode} "${e.title}": ${e.endingSummary}`)
      .join("\n");
    seriesNote = `\n\nSERIES CONTINUITY — this is episode ${opts.seriesContext.episodes.length + 1} of the series "${opts.seriesContext.seriesTitle}". Previous episodes:\n${history}\nContinue the story from the last episode's ending. Reference past events naturally; do not re-introduce the world from scratch.`;
  }

  const userPrompt = `Prompt: ${input.prompt}
Genre: ${input.genre || "slice-of-life"}
Pages: ${input.pages}
Style: ${input.style || "manga"}${langNote}${castNote}${seriesNote}

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

  const storyboard = parseStoryboard(text, input.pages);
  return applyFixedCast(storyboard, opts.fixedCharacters);
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

// The LLM sometimes paraphrases appearance text despite instructions. The
// stored text is canon — overwrite by name match (and add the character if it
// was dropped entirely) so every panel prompt uses identical wording.
export function applyFixedCast(storyboard: Storyboard, fixedCharacters?: Character[]): Storyboard {
  if (!fixedCharacters || fixedCharacters.length === 0) return storyboard;

  for (const fixed of fixedCharacters) {
    const existing = storyboard.characters.find(
      (c) => c.name.toLowerCase() === fixed.name.toLowerCase(),
    );
    if (existing) {
      existing.appearance = fixed.appearance;
      existing.name = fixed.name;
    } else {
      storyboard.characters.push({ ...fixed });
    }
  }
  return storyboard;
}

const REVISE_PROMPT = `You are a professional comic writer revising ONE page of an existing storyboard. Apply the requested change while keeping everything else consistent: same characters (same names), same visual world, same tone. Panels: 2-4. Dialogue under 30 chars per line. Same dialogueType/sfx/cameraAngle rules as before.

Output ONLY valid JSON with this exact shape (no wrapper):
{
  "page": number (keep the original page number),
  "panels": number,
  "storyBeat": "narration caption",
  "panelDescriptions": [{ "panel", "scene", "characters", "dialogue"?, "dialogueType"?, "dialogue2"?, "dialogue2Type"?, "sfx"?, "cameraAngle"? }]
}`;

// Rewrite a single page spec per the caller's instruction. Used by revise_page.
export async function reviseStoryboardPage(
  storyboard: Storyboard,
  pageNumber: number,
  instruction: string,
  language: string,
): Promise<PageSpec> {
  const original = storyboard.pages.find((p) => p.page === pageNumber);
  if (!original) throw new Error(`Page ${pageNumber} not found in storyboard`);

  const langNote = language !== "en" ? `\nDialogue language: ${language}.` : "";
  const cast = storyboard.characters.map((c) => `- ${c.name} (${c.role}): ${c.appearance}`).join("\n");

  const userPrompt = `Story: "${storyboard.title}" — ${storyboard.synopsis}
Cast (appearances are canon, do not change):
${cast}

Original page ${pageNumber} spec:
${JSON.stringify(original, null, 2)}

Revision instruction: ${instruction}${langNote}

Return the revised page spec JSON.`;

  const response = await client.chat.completions.create({
    model: config.sumopodModel,
    messages: [
      { role: "system", content: REVISE_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("Writer returned empty revision");

  return parseRevisedPage(text, pageNumber);
}

export function parseRevisedPage(json: string, pageNumber: number): PageSpec {
  const parsed = JSON.parse(json) as PageSpec;
  if (!parsed.panelDescriptions || parsed.panelDescriptions.length === 0) {
    throw new Error("Writer returned invalid page revision: missing panelDescriptions");
  }
  // Cap at 4 panels — that's the largest layout the renderer supports.
  parsed.panelDescriptions = parsed.panelDescriptions.slice(0, 4);
  parsed.panels = parsed.panelDescriptions.length;
  parsed.page = pageNumber;
  parsed.panelDescriptions.forEach((pd, i) => {
    pd.panel = i + 1;
  });
  if (!parsed.storyBeat) parsed.storyBeat = "";
  return parsed;
}
