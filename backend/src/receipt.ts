// Verifiable delivery: SHA-256 of every delivered file, a signed receipt the
// payer can present as proof of what they bought, and explicit license +
// provenance metadata so a commercial agent knows exactly what it may do with
// the output.
import fs from "node:fs";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import type { DeliveryIntegrity, DeliveryLicense, DeliveryReceipt } from "./types.js";

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

// Hash every delivered file in workDir that actually exists.
export function buildIntegrity(workDir: string, files: string[]): DeliveryIntegrity {
  const out: Record<string, string> = {};
  for (const file of files) {
    const p = path.join(workDir, file);
    if (fs.existsSync(p)) out[file] = sha256Hex(fs.readFileSync(p));
  }
  return { algorithm: "sha256", files: out };
}

// Signature covers jobId, the integrity map, and the issue time — enough for
// the payer to later prove which exact bytes were delivered for which job.
export function buildReceipt(jobId: string, integrity: DeliveryIntegrity): DeliveryReceipt {
  const issuedAt = new Date().toISOString();
  const payloadSha256 = sha256Hex(JSON.stringify({ jobId, files: integrity.files }));

  let signature: string | null = null;
  let note = "Unsigned: server has no RECEIPT_SECRET configured. File hashes are still verifiable.";
  if (config.receiptSecret) {
    signature = createHmac("sha256", config.receiptSecret)
      .update(`${jobId}.${payloadSha256}.${issuedAt}`)
      .digest("hex");
    note = "HMAC-SHA256 over `jobId.payloadSha256.issuedAt`. Present this receipt to the operator to verify delivery.";
  }

  return { jobId, issuedAt, payloadSha256, algorithm: "HMAC-SHA256", signature, note };
}

export function buildLicense(imageModel: string, seed: number, prompt: string): DeliveryLicense {
  return {
    usage: "The payer receives a worldwide, non-exclusive right to use, modify, distribute, and commercially exploit the generated comic.",
    attribution: "Not required.",
    aiDisclosure: "All images and story text are AI-generated. Some jurisdictions require AI disclosure for published content.",
    provenance: { imageModel, seed, promptSha256: sha256Hex(prompt) },
  };
}
