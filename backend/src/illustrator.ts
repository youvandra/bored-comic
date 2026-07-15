import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";

interface CfProvider {
  accountId: string;
  apiToken: string;
}

const PROVIDERS: CfProvider[] = [];

function initProviders(): void {
  if (config.cloudflareAccountId && config.cloudflareApiToken) {
    PROVIDERS.push({ accountId: config.cloudflareAccountId, apiToken: config.cloudflareApiToken });
  }
  if (config.cloudflareAccountId2 && config.cloudflareApiToken2) {
    PROVIDERS.push({ accountId: config.cloudflareAccountId2, apiToken: config.cloudflareApiToken2 });
  }
}

export interface ImageGenResult {
  path: string;
  promptChars: number;
}

export interface GeneratePanelInput {
  prompt: string;
  targetW: number;
  targetH: number;
  pageNumber: number;
  panelIndex: number;
  workDir: string;
  jobId: string;
}

export async function generatePanel(input: GeneratePanelInput): Promise<ImageGenResult> {
  const { prompt, pageNumber, panelIndex, workDir } = input;

  if (PROVIDERS.length === 0) initProviders();
  if (PROVIDERS.length === 0) throw new Error("No Cloudflare accounts configured");

  let lastErr: unknown;

  for (const provider of PROVIDERS) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${provider.accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

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
        }),
      });

      if (!response.ok) {
        const err = await response.text().catch(() => "unknown");
        if (response.status === 429 || (response.status === 400 && err.includes("daily free allocation"))) {
          lastErr = new Error(`Cloudflare quota exhausted for account ${provider.accountId.slice(0, 8)}...`);
          continue; // Try next provider
        }
        if (response.status === 400 && err.includes("NSFW")) {
          throw new Error("Image generation blocked: prompt triggered safety filter. Try rephrasing without sensitive words.");
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
      // Only retry with next provider on quota errors
      if (err instanceof Error && (err.message.includes("quota") || err.message.includes("daily free"))) {
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error("All Cloudflare accounts exhausted their quota");
}
