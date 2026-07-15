import type { Request, Response, NextFunction } from "express";
import { paymentMiddleware } from "@okxweb3/x402-express";
import { x402ResourceServer } from "@okxweb3/x402-express";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { config } from "./config.js";
import { hasImageProvider } from "./illustrator.js";
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
function preflightError(args: { prompt?: unknown; pages?: unknown } | undefined): string | null {
  if (!hasImageProvider()) return "Image generation is not configured (no Cloudflare account).";
  if (typeof args?.prompt !== "string" || args.prompt.length < 3) return "prompt must be a string of at least 3 characters.";
  const pages = args?.pages;
  if (typeof pages !== "number" || !Number.isInteger(pages) || pages < MIN_PAGES || pages > MAX_PAGES) {
    return `pages must be an integer between ${MIN_PAGES} and ${MAX_PAGES}.`;
  }
  return null;
}

export function x402Gate(req: Request, res: Response, next: NextFunction): void {
  if (!isEnabled()) return next();

  const body = req.body as { method?: string; params?: { name?: string; arguments?: { prompt?: unknown; pages?: number } } } | undefined;

  // Discovery and introspection stay free
  if (body?.method !== "tools/call") return next();
  const FREE_TOOLS = new Set(["get_quota", "clarify_comic"]);
  if (FREE_TOOLS.has(body?.params?.name ?? "")) return next();

  // Reject deterministic failures before charging — the exact scheme has no refund path.
  const preErr = preflightError(body?.params?.arguments);
  if (preErr) {
    res.status(400).json({
      jsonrpc: "2.0",
      id: (body as { id?: unknown })?.id ?? null,
      error: { code: -32602, message: `Rejected before payment: ${preErr}` },
    });
    return;
  }

  // No free quota — price scales with requested page count.
  const pages = body?.params?.arguments?.pages ?? 1;
  void paidFor(priceForPages(pages))(req, res, next);
}

export function x402Info(): Record<string, unknown> {
  return {
    enabled: isEnabled(),
    x402Version: 2,
    pricing: {
      basePerToolCall: `$${config.x402PriceUsd}`,
      tiers: {
        "1-3 pages": `$${priceForPages(1)}`,
        "4-6 pages": `$${priceForPages(4)}`,
        "7-10 pages": `$${priceForPages(7)}`,
      },
      asset: USDT0_XLAYER,
      assetSymbol: "USDT0",
      network: NETWORK,
      payTo: config.x402PayTo || null,
    },
    settlement: "on-chain, settled by the OKX facilitator (@okxweb3/x402-express)",
    metered: ["tools/call on POST /mcp"],
    free: ["initialize", "tools/list", "get_quota", "clarify_comic"],
    note: "No free daily quota — every tools/call past discovery requires payment.",
  };
}
