// Vision QA: a free Cloudflare Workers AI vision model (LLaVA 1.5) inspects
// finished pages and cover candidates. Two jobs:
// 1. qaPage — grade every delivered page (1-10 + notes) so the delivery
//    carries an independent quality signal the paying agent can act on.
// 2. pickBestCover — judge two cover candidates and keep the stronger one.
// Everything here is best-effort: any failure degrades to "no QA", never to a
// failed (already paid) comic.
import fs from "node:fs";
import sharp from "sharp";
import { config } from "./config.js";

const VISION_MODEL = "@cf/llava-hf/llava-1.5-7b-hf";
const REQUEST_TIMEOUT_MS = 30_000;

export function visionEnabled(): boolean {
  return config.qaMode !== "off" && config.cloudflareAccounts.length > 0;
}

// LLaVA takes the image as a byte array in JSON — shrink it first so the
// request body stays small (512px JPEG ≈ 60-100 KB).
async function imageBytes(imagePath: string): Promise<number[] | null> {
  try {
    const buf = await sharp(imagePath)
      .resize(512, 512, { fit: "inside" })
      .jpeg({ quality: 80 })
      .toBuffer();
    return Array.from(buf);
  } catch {
    return null;
  }
}

export async function describeImage(imagePath: string, prompt: string): Promise<string | null> {
  if (!visionEnabled() || !fs.existsSync(imagePath)) return null;
  const image = await imageBytes(imagePath);
  if (!image) return null;

  for (const provider of config.cloudflareAccounts) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${provider.accountId}/ai/run/${VISION_MODEL}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${provider.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ image, prompt, max_tokens: 256 }),
        signal: controller.signal,
      });
      if (!response.ok) continue; // quota/model errors: try next account
      const data = await response.json() as { success?: boolean; result?: { description?: string } };
      const text = data.result?.description?.trim();
      if (text) return text;
    } catch {
      // timeout or network error — try the next account
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// Pull a 1-10 score out of free-form judge text ("Score: 8", "8/10", "I'd
// rate this a 7 because..."). Returns null when no plausible score is found.
export function parseScore(text: string): number | null {
  const scored = text.match(/(?:score|rating|rate)\D{0,10}(10|[1-9])\b/i);
  if (scored) return Number(scored[1]);
  const slash = text.match(/\b(10|[1-9])\s*\/\s*10\b/);
  if (slash) return Number(slash[1]);
  const bare = text.match(/\b(10|[1-9])\b/);
  if (bare) return Number(bare[1]);
  return null;
}

export interface PageQaResult {
  score: number;
  notes: string;
}

export async function qaPage(imagePath: string, characterHints: string): Promise<PageQaResult | null> {
  const prompt =
    "You are a comic book quality inspector. Look at this comic page and rate its overall quality " +
    "from 1 to 10, considering: visual artifacts or distortions (extra limbs, warped faces, garbled shapes), " +
    "clarity of the artwork, and whether the characters look consistent with this cast: " +
    `${characterHints}. ` +
    "Reply in this exact format: 'Score: N. <one short sentence of the most important issue, or \"looks clean\">'.";

  const text = await describeImage(imagePath, prompt);
  if (!text) return null;
  const score = parseScore(text);
  if (score === null) return null;
  return { score, notes: text.slice(0, 300) };
}

// Judge two cover candidates with the same rubric; keep the stronger one.
// Any failure (model down, unparseable) falls back to the first candidate.
export async function pickBestCover(pathA: string, pathB: string, synopsis: string): Promise<{ winner: string; scores: [number, number] | null }> {
  const prompt =
    "You are a comic book art director choosing a cover. Rate this cover candidate from 1 to 10 for: " +
    "striking composition, a clear focal character, and how well it fits this story: " +
    `"${synopsis.slice(0, 200)}". ` +
    "Reply in this exact format: 'Score: N. <one short reason>'.";

  const [textA, textB] = [await describeImage(pathA, prompt), await describeImage(pathB, prompt)];
  const scoreA = textA ? parseScore(textA) : null;
  const scoreB = textB ? parseScore(textB) : null;
  if (scoreA === null || scoreB === null) return { winner: pathA, scores: null };
  return { winner: scoreB > scoreA ? pathB : pathA, scores: [scoreA, scoreB] };
}
