import type { Request, Response, NextFunction } from "express";
import { paymentMiddleware } from "@okxweb3/x402-express";
import { x402ResourceServer } from "@okxweb3/x402-express";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { config } from "./config.js";
import { hasImageProvider } from "./illustrator.js";
import { getCharacters, getJob } from "./store.js";
import { MAX_PAGES, MIN_PAGES } from "./types.js";

const NETWORK = "eip155:196";
const USDT0_XLAYER = "0x779ded0c9e1022225f8e0630b35a9b54be713736";

const isEnabled = () => config.x402Mode !== "off" && !!config.x402PayTo;

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

// Tiered pricing by page count (matches PLAN.md): 1-3 / 4-6 / 7-10 pages.
// Multiplier is applied to the configured base price.
function tierMultiplier(pages: number): number {
  if (pages >= 7) return 3;
  if (pages >= 4) return 2;
  return 1;
}

export function priceForPages(pages: number): string {
  const base = Number(config.x402PriceUsd) || 0;
  const price = base * tierMultiplier(pages || 1);
  return price.toFixed(2);
}

// Per-tool pricing. generate_comic scales with page count; revise_page and
// create_character are single generations, so they cost the base rate.
const FREE_TOOLS = new Set(["get_quota", "clarify_comic", "get_character", "get_series", "create_series", "get_job"]);
const PAID_TOOLS = new Set(["generate_comic", "revise_page", "create_character"]);

export function priceForTool(tool: string, args: { pages?: unknown } | undefined): string | null {
  if (FREE_TOOLS.has(tool) || !PAID_TOOLS.has(tool)) return null;
  if (tool === "generate_comic") {
    const pages = typeof args?.pages === "number" ? args.pages : 1;
    return priceForPages(pages);
  }
  return priceForPages(1); // base rate: revise_page, create_character
}

// Cache one paid middleware per distinct price string.
const paidByPrice = new Map<string, Handler>();

function buildPaidMiddleware(price: string): Handler {
  const facilitator = new OKXFacilitatorClient({
    apiKey: config.xlayerApiKey,
    secretKey: config.xlayerSecretKey,
    passphrase: config.xlayerPassphrase,
    syncSettle: true,
  });

  const resourceServer = new x402ResourceServer(facilitator).register(
    NETWORK,
    new ExactEvmScheme(),
  );

  return paymentMiddleware(
    {
      "POST /mcp": {
        accepts: {
          scheme: "exact",
          price: `$${price}`,
          network: NETWORK,
          payTo: config.x402PayTo,
        },
        description: "BoredComic comic generation tool call",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ) as unknown as Handler;
}

function paidFor(price: string): Handler {
  let mw = paidByPrice.get(price);
  if (!mw) {
    mw = buildPaidMiddleware(price);
    paidByPrice.set(price, mw);
  }
  return mw;
}

// Cheap, deterministic checks that would otherwise fail *after* payment.
// The `exact` scheme can't refund a settled payment, so we reject these up front.
type ToolArgs = {
  prompt?: unknown;
  pages?: unknown;
  characterIds?: unknown;
  seriesId?: unknown;
  jobId?: unknown;
  page?: unknown;
  instruction?: unknown;
  name?: unknown;
  appearance?: unknown;
};

function preflightError(tool: string, args: ToolArgs | undefined): string | null {
  if (tool === "generate_comic") {
    if (!hasImageProvider()) return "Image generation is not configured (no Cloudflare account).";
    if (typeof args?.prompt !== "string" || args.prompt.length < 3) return "prompt must be a string of at least 3 characters.";
    const pages = args?.pages;
    if (typeof pages !== "number" || !Number.isInteger(pages) || pages < MIN_PAGES || pages > MAX_PAGES) {
      return `pages must be an integer between ${MIN_PAGES} and ${MAX_PAGES}.`;
    }
    // Unknown character/series IDs fail deterministically — reject pre-payment.
    if (Array.isArray(args?.characterIds) && args.characterIds.length > 0) {
      const ids = args.characterIds.filter((id): id is string => typeof id === "string");
      const found = new Set(getCharacters(ids).map((c) => c.characterId));
      const missing = ids.filter((id) => !found.has(id));
      if (missing.length > 0) return `Unknown characterId(s): ${missing.join(", ")}. Register them first with create_character.`;
    }
    return null;
  }

  if (tool === "revise_page") {
    if (!hasImageProvider()) return "Image generation is not configured (no Cloudflare account).";
    if (typeof args?.jobId !== "string" || !getJob(args.jobId)) {
      return "jobId is unknown or its revision window has expired.";
    }
    if (typeof args?.page !== "number" || !Number.isInteger(args.page) || args.page < 1) return "page must be a positive integer.";
    if (typeof args?.instruction !== "string" || args.instruction.length < 3) return "instruction must be a string of at least 3 characters.";
    return null;
  }

  if (tool === "create_character") {
    if (!hasImageProvider()) return "Image generation is not configured (no Cloudflare account).";
    if (typeof args?.name !== "string" || args.name.length < 1) return "name is required.";
    if (typeof args?.appearance !== "string" || args.appearance.length < 20) {
      return "appearance must be a detailed visual description (at least 20 characters).";
    }
    return null;
  }

  return null;
}

export function x402Gate(req: Request, res: Response, next: NextFunction): void {
  if (!isEnabled()) return next();

  const body = req.body as { method?: string; params?: { name?: string; arguments?: ToolArgs } } | undefined;

  // Discovery, introspection, and store lookups stay free.
  if (body?.method !== "tools/call") return next();
  const tool = body?.params?.name ?? "";
  const price = priceForTool(tool, body?.params?.arguments as { pages?: unknown });
  if (price === null) return next();

  // Reject deterministic failures before charging — the exact scheme has no refund path.
  const preErr = preflightError(tool, body?.params?.arguments);
  if (preErr) {
    res.status(400).json({
      jsonrpc: "2.0",
      id: (body as { id?: unknown })?.id ?? null,
      error: { code: -32602, message: `Rejected before payment: ${preErr}` },
    });
    return;
  }

  // If the request carries a payment proof, let the SDK verify + settle it.
  // The OKX SDK reads the proof from the PAYMENT-SIGNATURE header (Node lowercases
  // header keys); the others are kept as harmless fallbacks.
  if (
    req.headers["payment-signature"] ||
    req.headers["x-payment"] ||
    req.headers["x402-authorization"] ||
    req.headers["x402-payment"] ||
    req.headers["x-pay-signature"]
  ) {
    void paidFor(price)(req, res, next);
    return;
  }

  // No payment proof — return a proper x402 v2 challenge with PAYMENT-REQUIRED header
  const amount = Math.round(Number(price) * 1000000).toString();
  const challenge = {
    x402Version: 2,
    resource: {
      url: `${req.protocol}://${req.get("host")}/mcp`,
      description: "BoredComic comic generation tool call",
      mimeType: "application/json",
    },
    accepts: [{
      scheme: "exact",
      network: NETWORK,
      amount,
      asset: USDT0_XLAYER,
      payTo: config.x402PayTo,
      maxTimeoutSeconds: 300,
      extra: { name: "USD₮0", version: "1" },
    }],
  };
  res.setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(challenge)).toString("base64"));
  res.status(402).json(challenge);
}

export function x402Info(): Record<string, unknown> {
  return {
    enabled: isEnabled(),
    x402Version: 2,
    pricing: {
      basePerToolCall: `$${config.x402PriceUsd}`,
      tools: {
        generate_comic: {
          "1-3 pages": `$${priceForPages(1)}`,
          "4-6 pages": `$${priceForPages(4)}`,
          "7-10 pages": `$${priceForPages(7)}`,
        },
        revise_page: `$${priceForPages(1)}`,
        create_character: `$${priceForPages(1)}`,
      },
      asset: USDT0_XLAYER,
      assetSymbol: "USDT0",
      network: NETWORK,
      payTo: config.x402PayTo || null,
    },
    settlement: "on-chain, settled by the OKX facilitator (@okxweb3/x402-express)",
    metered: ["generate_comic", "revise_page", "create_character"],
    free: ["initialize", "tools/list", "get_quota", "clarify_comic", "get_character", "get_series", "create_series", "get_job"],
    note: "No free daily quota — every metered tools/call requires payment.",
  };
}
