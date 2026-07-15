import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || "3001"),
  nodeEnv: process.env.NODE_ENV || "development",

  sumopodApiKey: process.env.SUMOPOD_API_KEY || "",
  sumopodBaseUrl: process.env.SUMOPOD_BASE_URL || "https://ai.sumopod.com/v1",
  sumopodModel: process.env.SUMOPOD_MODEL || "deepseek-v4-flash",

  replicateApiToken: process.env.REPLICATE_API_TOKEN || "",

  comicDir: process.env.COMIC_DIR || "/tmp/comicgen",
  comicTtlMs: Number(process.env.COMIC_TTL_MS || "86400000"),

  x402Mode: (process.env.X402_MODE || "off") as "off" | "demo" | "on",
  x402PayTo: process.env.X402_PAY_TO || "",
  x402PriceUsd: process.env.X402_PRICE_USD || "0.05",
  x402FreeDaily: Number(process.env.X402_FREE_DAILY || "20"),
};
