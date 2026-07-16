// Character registration: store a canonical appearance + a stable seed, and
// generate a reference character sheet the agent can inspect. Registered
// characters can then star in any number of comics (and series) with a
// consistent visual baseline — the switching-cost feature.
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import type { ComicStyle, StoredCharacter } from "./types.js";
import { generatePanel } from "./illustrator.js";
import { characterImageDir, newId, saveCharacter } from "./store.js";
import { styleTag, NO_TEXT_TAG } from "./pipeline.js";

export interface CreateCharacterInput {
  name: string;
  role?: string;
  appearance: string;
  style?: ComicStyle;
}

export function buildCharacterSheetPrompt(appearance: string, style: string): string {
  return `character reference sheet, single character, full body standing pose, front view, neutral expression, plain white background, ${appearance}. ${styleTag(style)}, model sheet, clean bold linework, professional character design.${NO_TEXT_TAG}`;
}

export async function createCharacter(input: CreateCharacterInput): Promise<StoredCharacter> {
  const characterId = newId("ch");
  const style: ComicStyle = input.style || "manga";
  const seed = Math.floor(Math.random() * 1_000_000_000);

  const dir = characterImageDir(characterId);
  await mkdir(dir, { recursive: true });

  // Reference sheet is best-effort: registration still succeeds if image
  // generation fails — the canonical appearance text and seed are the moat.
  let referenceUrl: string | null = null;
  try {
    const prompt = buildCharacterSheetPrompt(input.appearance, style);
    const img = await generatePanel({ prompt, seed, pageNumber: 0, panelIndex: 0, workDir: dir, jobId: characterId });
    const refPath = join(dir, "reference.png");
    await rename(img.path, refPath);
    referenceUrl = `/characters/${characterId}/reference.png`;
  } catch {
    referenceUrl = null;
  }

  const now = new Date().toISOString();
  const character: StoredCharacter = {
    characterId,
    name: input.name,
    role: input.role || "character",
    appearance: input.appearance,
    style,
    seed,
    referenceUrl,
    createdAt: now,
    updatedAt: now,
  };
  saveCharacter(character);
  return character;
}
