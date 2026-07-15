import "dotenv/config";

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

  x402Mode: (process.env.X402_MODE || "off") as "off" | "demo" | "on",
  x402PayTo: process.env.X402_PAY_TO || "",
  x402PriceUsd: process.env.X402_PRICE_USD || "0.05",
};
