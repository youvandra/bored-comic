import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config, type CloudflareAccount } from "./config.js";

const PROVIDERS: CloudflareAccount[] = [];

function initProviders(): void {
  PROVIDERS.push(...config.cloudflareAccounts);
}

// True if at least one Cloudflare account is configured. Used for preflight
// so requests are rejected before payment when image generation can't run.
export function hasImageProvider(): boolean {
  if (PROVIDERS.length === 0) initProviders();
  return PROVIDERS.length > 0;
}

export interface ImageGenResult {
  path: string;
  promptChars: number;
}

export interface GeneratePanelInput {
  prompt: string;
  seed?: number;
  pageNumber: number;
  panelIndex: number;
  workDir: string;
  jobId: string;
}

const REQUEST_TIMEOUT_MS = 60_000;

class NsfwError extends Error {}

// The safety filter often trips on a single innocuous word ("haunted", "blade").
// Strip the hard triggers and add safe-for-work modifiers so a retry can pass.
function softenPrompt(prompt: string): string {
  const triggers = /\b(blood\w*|gore|gory|corpse|severed|dismember\w*|mutilat\w*|nude|naked|nsfw|sexy|seductive|lingerie|wound\w*)\b/gi;
  return `wholesome, safe for work, non-graphic, tasteful, non-violent. ${prompt.replace(triggers, "")}`;
}

export async function generatePanel(input: GeneratePanelInput): Promise<ImageGenResult> {
  const { prompt, seed, pageNumber, panelIndex, workDir } = input;

  if (PROVIDERS.length === 0) initProviders();
  if (PROVIDERS.length === 0) throw new Error("No Cloudflare accounts configured");

  try {
    return await tryPrompt(prompt, seed, pageNumber, panelIndex, workDir);
  } catch (err) {
    if (err instanceof NsfwError) {
      // One softened retry before giving up so a paid comic still completes.
      return tryPrompt(softenPrompt(prompt), seed, pageNumber, panelIndex, workDir);
    }
    throw err;
  }
}

async function tryPrompt(
  prompt: string,
  seed: number | undefined,
  pageNumber: number,
  panelIndex: number,
  workDir: string,
): Promise<ImageGenResult> {
  let lastErr: unknown;

  for (const provider of PROVIDERS) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${provider.accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${provider.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          steps: config.fluxSteps,
          ...(seed !== undefined ? { seed } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.text().catch(() => "unknown");
        if (response.status === 429 || (response.status === 400 && err.includes("daily free allocation"))) {
          lastErr = new Error(`Cloudflare quota exhausted for account ${provider.accountId.slice(0, 8)}...`);
          continue; // Try next provider
        }
        if (response.status === 400 && err.includes("NSFW")) {
          throw new NsfwError("Image generation blocked: prompt triggered safety filter. Try rephrasing without sensitive words.");
        }
        throw new Error(`Cloudflare AI error (${response.status}): ${err}`);
      }

      const data = await response.json() as { success: boolean; result?: { image?: string }; errors?: string[] };
      if (!data.success || !data.result?.image) {
        const msg = data.errors?.[0] || "unknown";
        throw new Error(`Image generation failed: ${msg}`);
      }

      const buffer = Buffer.from(data.result.image, "base64");
      const filename = `panel-${pageNumber}-${panelIndex}.png`;
      const filepath = join(workDir, filename);
      await writeFile(filepath, buffer);

      return { path: filepath, promptChars: prompt.length };

    } catch (err) {
      lastErr = err;
      // Timeout: abort this provider and try the next one.
      if (err instanceof Error && err.name === "AbortError") {
        lastErr = new Error(`Cloudflare request timed out after ${REQUEST_TIMEOUT_MS / 1000}s for account ${provider.accountId.slice(0, 8)}...`);
        continue;
      }
      // Only retry with next provider on quota errors
      if (err instanceof Error && (err.message.includes("quota") || err.message.includes("daily free"))) {
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr || new Error("All Cloudflare accounts exhausted their quota");
}
