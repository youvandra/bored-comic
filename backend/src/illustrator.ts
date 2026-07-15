import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";

const CF_AI_URL = `https://api.cloudflare.com/client/v4/accounts/${config.cloudflareAccountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

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

  const response = await fetch(CF_AI_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.cloudflareApiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      steps: config.fluxSteps,
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "unknown");
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
}
