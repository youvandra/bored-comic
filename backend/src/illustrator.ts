import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";

const REPLICATE_API = "https://api.replicate.com/v1/models/black-forest-labs/flux-2-pro/predictions";

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
  const { prompt, pageNumber, panelIndex, workDir, jobId } = input;

  const response = await fetch(REPLICATE_API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.replicateApiToken}`,
      "Content-Type": "application/json",
      "Prefer": "wait",
    },
    body: JSON.stringify({
      input: {
        prompt,
        aspect_ratio: "1:1",
        num_outputs: 1,
        output_format: "png",
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "unknown");
    throw new Error(`Replicate API error (${response.status}): ${err}`);
  }

  const data = await response.json() as { status: string; output?: string | string[]; error?: string };
  if (data.status !== "succeeded" || !data.output) {
    throw new Error(`Replicate generation failed: ${data.error || data.status}`);
  }

  const imageUrl = typeof data.output === "string" ? data.output : data.output[0];
  if (!imageUrl) throw new Error("Replicate returned empty output");

  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) throw new Error(`Failed to download generated image: ${imageRes.status}`);

  const buffer = Buffer.from(await imageRes.arrayBuffer());
  const filename = `panel-${pageNumber}-${panelIndex}.png`;
  const filepath = join(workDir, filename);
  await writeFile(filepath, buffer);

  return { path: filepath, promptChars: prompt.length };
}
