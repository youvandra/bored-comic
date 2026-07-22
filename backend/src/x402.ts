import type { Request, Response, NextFunction } from "express";
import { paymentMiddleware } from "@okxweb3/x402-express";
import { x402ResourceServer } from "@okxweb3/x402-express";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { config } from "./config.js";
import { hasImageProvider } from "./illustrator.js";
import { getCharacters, getJob } from "./store.js";
import { MIN_PAGES } from "./types.js";

const NETWORK = "eip155:196";
const USDT0_XLAYER = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const USDT0_DECIMALS = 6;

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

export const x402Enabled = (): boolean =>
  config.x402Mode !== "off" && !!config.x402PayTo;

const paidCache = new Map<string, Handler>();

function buildPaidMiddleware(routeKey: string, description: string, priceUsd: string): Handler {
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
      [routeKey]: {
        accepts: {
          scheme: "exact",
          price: `$${priceUsd}`,
          network: NETWORK,
          payTo: config.x402PayTo,
        },
        description,
        mimeType: "application/json",
      },
    },
    resourceServer,
  ) as unknown as Handler;
}

export function paidRoute(routeKey: string, description: string, priceUsd: string): Handler {
  return (req, res, next) => {
    if (!x402Enabled()) return next();

    const hasProof =
      req.headers["payment-signature"] ||
      req.headers["x-payment"] ||
      req.headers["x402-authorization"] ||
      req.headers["x402-payment"];

    if (hasProof) {
      let mw = paidCache.get(routeKey);
      if (!mw) {
        mw = buildPaidMiddleware(routeKey, description, priceUsd);
        paidCache.set(routeKey, mw);
      }
      return void mw(req, res, next);
    }
    return send402Challenge(req, res, description, priceUsd);
  };
}

/**
 * x402 gate for an MCP endpoint. The MCP protocol/discovery methods
 * (initialize, notifications/*, tools/list, ping) MUST stay free so an MCP
 * client — including the OKX listing validator — can complete the handshake
 * and discover tools. Only `tools/call` is metered. Gating the whole endpoint
 * (plain paidRoute) 402s the handshake itself, so the validator never gets a
 * usable response and the review times out.
 */
// Read-only / metadata tools stay free (introspection + polling); only the
// generative tools (generate_comic, revise_page, create_character) are metered.
// A caller must be able to poll get_job / check get_quota without paying.
const FREE_TOOLS = new Set([
  "get_quota",
  "get_job",
  "get_character",
  "get_series",
  "create_series",
  "clarify_comic",
]);

export function mcpPaidRoute(routeKey: string, description: string, priceUsd: string): Handler {
  const paid = paidRoute(routeKey, description, priceUsd);
  return (req, res, next) => {
    const body = req.body as { method?: string; params?: { name?: string } } | undefined;
    if (body?.method !== "tools/call") return next();
    if (FREE_TOOLS.has(body?.params?.name ?? "")) return next();
    return void paid(req, res, next);
  };
}

export function send402Challenge(req: Request, res: Response, description: string, priceUsd: string): void {
  const amount = Math.round(Number(priceUsd) * 10 ** USDT0_DECIMALS).toString();
  const challenge = {
    x402Version: 2,
    resource: {
      url: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
      description,
      mimeType: "application/json",
    },
    accepts: [{
      scheme: "exact",
      network: NETWORK,
      amount,
      asset: USDT0_XLAYER,
      payTo: config.x402PayTo,
      // Must match the window the OKX facilitator accepts for EIP-3009
      // authorizations on X Layer (the working WalletLens ASP uses 300). A
      // longer window makes the buyer sign a validBefore the facilitator
      // rejects, so verification fails with an empty 402 before settling.
      maxTimeoutSeconds: 300,
      extra: { name: "USD₮0", version: "1" },
    }],
  };
  res.setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(challenge)).toString("base64"));
  res.status(402).json(challenge);
}

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

export function preflightError(tool: string, args: ToolArgs | undefined, maxPages: number): string | null {
  if (tool === "generate_comic") {
    if (!hasImageProvider()) return "Image generation is not configured (no Cloudflare account).";
    if (typeof args?.prompt !== "string" || args.prompt.length < 3) return "prompt must be a string of at least 3 characters.";
    const pages = args?.pages;
    if (typeof pages !== "number" || !Number.isInteger(pages) || pages < MIN_PAGES || pages > maxPages) {
      return `pages must be an integer between ${MIN_PAGES} and ${maxPages}.`;
    }
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

// MCP preflight middleware: parses JSON-RPC body and rejects bad input before payment.
export function mcpPreflight(maxPages?: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const body = req.body as { method?: string; id?: unknown; params?: { name?: string; arguments?: ToolArgs } } | undefined;
    if (body?.method !== "tools/call") return next();

    const tool = body?.params?.name ?? "";
    const pages = maxPages ?? 10;
    const preErr = preflightError(tool, body?.params?.arguments, pages);
    if (preErr) {
      res.status(400).json({
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: { code: -32602, message: `Rejected before payment: ${preErr}` },
      });
      return;
    }
    next();
  };
}

export function x402Info(price: string = config.x402PriceUsd): Record<string, unknown> {
  return {
    enabled: x402Enabled(),
    x402Version: 2,
    pricing: {
      perToolCall: `$${price}`,
      asset: USDT0_XLAYER,
      assetSymbol: "USDT0",
      network: NETWORK,
      payTo: config.x402PayTo || null,
    },
    settlement: "on-chain, settled by the OKX facilitator (@okxweb3/x402-express)",
    note: "No free daily quota — every metered tools/call requires payment.",
  };
}
