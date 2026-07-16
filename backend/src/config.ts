import "dotenv/config";
import path from "node:path";

export interface CloudflareAccount {
  accountId: string;
  apiToken: string;
}

function collectCloudflareAccounts(): CloudflareAccount[] {
  const accounts: CloudflareAccount[] = [];
  const push = (id?: string, token?: string) => {
    if (id && token) accounts.push({ accountId: id, apiToken: token });
  };
  push(process.env.CLOUDFLARE_ACCOUNT_ID, process.env.CLOUDFLARE_API_TOKEN);
  for (let i = 2; i <= 8; i++) {
    push(process.env[`CLOUDFLARE_ACCOUNT_ID_${i}`], process.env[`CLOUDFLARE_API_TOKEN_${i}`]);
  }
  return accounts;
}

export const config = {
  port: Number(process.env.PORT || "3001"),
  nodeEnv: process.env.NODE_ENV || "development",

  sumopodApiKey: process.env.SUMOPOD_API_KEY || "",
  sumopodBaseUrl: process.env.SUMOPOD_BASE_URL || "https://ai.sumopod.com/v1",
  sumopodModel: process.env.SUMOPOD_MODEL || "deepseek-v4-flash",

  // Cloudflare accounts for image generation, tried in order for quota fallback.
  // CLOUDFLARE_ACCOUNT_ID/_TOKEN is the first; _2, _3, ... add more.
  cloudflareAccounts: collectCloudflareAccounts(),

  fluxSteps: Number(process.env.FLUX_STEPS || "8"),
  // Max simultaneous image requests across all jobs, to smooth quota bursts.
  fluxConcurrency: Number(process.env.FLUX_CONCURRENCY || "4"),

  xlayerApiKey: process.env.XLAYER_API_KEY || "",
  xlayerSecretKey: process.env.XLAYER_SECRET_KEY || "",
  xlayerPassphrase: process.env.XLAYER_PASSPHRASE || "",

  comicDir: process.env.COMIC_DIR || "/tmp/boredcomic",
  comicTtlMs: Number(process.env.COMIC_TTL_MS || "86400000"),

  // Persistent store for characters, series, and job storyboards. Unlike
  // comicDir this must survive restarts — it's the state behind character
  // persistence, series continuity, and revise_page.
  dataDir: path.resolve(process.env.DATA_DIR || "./data"),
  // Stored jobs older than this can no longer be revised (default 7 days).
  jobTtlMs: Number(process.env.JOB_TTL_MS || "604800000"),
  // HMAC key for signed delivery receipts. Unset → receipts are unsigned.
  receiptSecret: process.env.RECEIPT_SECRET || "",

  // Public origin for absolute URLs in deliveries (readerUrl). Empty → relative.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, ""),
  // Vision QA: "basic" grades every delivered page with a vision model and
  // picks the better of two cover candidates; "off" disables both.
  qaMode: (process.env.QA_MODE || "basic") as "off" | "basic",

  x402Mode: (process.env.X402_MODE || "off") as "off" | "demo" | "on",
  x402PayTo: process.env.X402_PAY_TO || "",
  x402PriceUsd: process.env.X402_PRICE_USD || "0.05",
};
