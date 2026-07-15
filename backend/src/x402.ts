import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";

export function x402Gate(req: Request, res: Response, next: NextFunction): void {
  if (config.x402Mode === "off") return next();

  const body = req.body as { method?: string; params?: { name?: string } } | undefined;

  // Let discovery pass through
  if (body?.method !== "tools/call") return next();

  // Quota introspection stays free
  const FREE_TOOLS = new Set(["get_quota"]);
  if (FREE_TOOLS.has(body?.params?.name ?? "")) return next();

  res.status(402).json({
    error: "Payment required",
    x402Version: 2,
    pricing: {
      perToolCall: `$${config.x402PriceUsd}`,
      assetSymbol: "USDT0",
      network: "eip155:196",
    },
  });
}

export function x402Info(): Record<string, unknown> {
  const isEnabled = config.x402Mode !== "off" && !!config.x402PayTo;
  return {
    enabled: isEnabled,
    x402Version: 2,
    pricing: {
      perToolCall: `$${config.x402PriceUsd}`,
      network: "eip155:196",
      payTo: config.x402PayTo || null,
    },
    free: ["initialize", "tools/list", "get_quota"],
    note: "All tool calls are paid via x402 — no free daily quota. Call get_quota for pricing before your first call.",
  };
}
