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
      steps: 4,
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "unknown");
    throw new Error(`Cloudflare AI error (${response.status}): ${err}`);
  }

  const data = await response.json() as { success: boolean; result?: { image?: string }; errors?: string[] };
  if (!data.success || !data.result?.image) {
    throw new Error(`Cloudflare AI generation failed: ${data.errors?.[0] || "unknown"}`);
  }

  const buffer = Buffer.from(data.result.image, "base64");
  const filename = `panel-${pageNumber}-${panelIndex}.png`;
  const filepath = join(workDir, filename);
  await writeFile(filepath, buffer);

  return { path: filepath, promptChars: prompt.length };
}
