import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || "3001"),
  nodeEnv: process.env.NODE_ENV || "development",

  sumopodApiKey: process.env.SUMOPOD_API_KEY || "",
  sumopodBaseUrl: process.env.SUMOPOD_BASE_URL || "https://ai.sumopod.com/v1",
  sumopodModel: process.env.SUMOPOD_MODEL || "deepseek-v4-flash",

  cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || "",
  cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN || "",

  fluxSteps: Number(process.env.FLUX_STEPS || "8"),

  xlayerApiKey: process.env.XLAYER_API_KEY || "",
  xlayerSecretKey: process.env.XLAYER_SECRET_KEY || "",
  xlayerPassphrase: process.env.XLAYER_PASSPHRASE || "",

  comicDir: process.env.COMIC_DIR || "/tmp/boredcomic",
  comicTtlMs: Number(process.env.COMIC_TTL_MS || "86400000"),

  x402Mode: (process.env.X402_MODE || "off") as "off" | "demo" | "on",
  x402PayTo: process.env.X402_PAY_TO || "",
  x402PriceUsd: process.env.X402_PRICE_USD || "0.05",
};
