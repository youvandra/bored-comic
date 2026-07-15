import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";

interface QuotaEntry {
  day: string;
  used: number;
}

const quota = new Map<string, QuotaEntry>();
let sweepDay = "";

function sweepStale(day: string): void {
  if (day === sweepDay) return;
  for (const [ip, entry] of quota) {
    if (entry.day !== day) quota.delete(ip);
  }
  sweepDay = day;
}

export function quotaStatus(ip: string): {
  enabled: boolean;
  freeDaily: number;
  usedToday: number;
  remainingToday: number;
} {
  const day = new Date().toISOString().slice(0, 10);
  const entry = quota.get(ip);
  const usedToday = entry && entry.day === day ? entry.used : 0;
  return {
    enabled: config.x402Mode !== "off" && !!config.x402PayTo,
    freeDaily: config.x402FreeDaily,
    usedToday,
    remainingToday: Math.max(0, config.x402FreeDaily - usedToday),
  };
}

function takeFreeCall(ip: string): number {
  const day = new Date().toISOString().slice(0, 10);
  sweepStale(day);
  const entry = quota.get(ip);
  if (!entry || entry.day !== day) {
    quota.set(ip, { day, used: 1 });
    return config.x402FreeDaily - 1;
  }
  if (entry.used >= config.x402FreeDaily) return -1;
  entry.used++;
  return config.x402FreeDaily - entry.used;
}

export function x402Gate(req: Request, res: Response, next: NextFunction): void {
  if (config.x402Mode === "off") return next();

  const body = req.body as { method?: string; params?: { name?: string } } | undefined;
  if (body?.method !== "tools/call") return next();

  const FREE_TOOLS = new Set(["get_quota"]);
  if (FREE_TOOLS.has(body?.params?.name ?? "")) return next();

  const remaining = takeFreeCall(req.ip || "unknown");
  if (remaining >= 0) {
    res.setHeader("X-Free-Calls-Remaining", String(remaining));
    return next();
  }

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
      freeDailyCallsPerIp: config.x402FreeDaily,
    },
    free: ["initialize", "tools/list", "get_quota"],
  };
}
