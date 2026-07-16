// Dependency-free in-memory rate limiting. Two concerns:
// 1. A general per-IP cap on /mcp so a single client can't hammer the server.
// 2. A tighter cap on free tools that write to the persistent store
//    (create_series) — otherwise a free, unmetered call could fill the disk.
// State is per-process and resets on restart, which is acceptable: this guards
// against abuse, not billing.
import type { Request, Response, NextFunction } from "express";

interface Window {
  count: number;
  resetAt: number;
}

export class SlidingLimiter {
  private windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  // True if this hit is allowed; false if the key is over its limit.
  hit(key: string): boolean {
    const now = Date.now();
    const w = this.windows.get(key);
    if (!w || now >= w.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    w.count++;
    return w.count <= this.limit;
  }

  // Drop expired windows so the map can't grow unbounded.
  sweep(): void {
    const now = Date.now();
    for (const [key, w] of this.windows) {
      if (now >= w.resetAt) this.windows.delete(key);
    }
  }
}

const generalLimiter = new SlidingLimiter(120, 60_000); // 120 req/min per IP on /mcp
const freeWriteLimiter = new SlidingLimiter(20, 3_600_000); // 20 series/hour per IP

// Free tools that create persistent state — the ones worth throttling harder.
const FREE_WRITE_TOOLS = new Set(["create_series"]);

setInterval(() => {
  generalLimiter.sweep();
  freeWriteLimiter.sweep();
}, 60_000).unref();

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || "unknown";

  if (!generalLimiter.hit(ip)) {
    res.status(429).json({
      jsonrpc: "2.0",
      id: (req.body as { id?: unknown })?.id ?? null,
      error: { code: -32000, message: "Rate limit exceeded: max 120 requests/minute per IP. Slow down and retry." },
    });
    return;
  }

  const body = req.body as { method?: string; params?: { name?: string } } | undefined;
  const tool = body?.method === "tools/call" ? body?.params?.name ?? "" : "";
  if (FREE_WRITE_TOOLS.has(tool) && !freeWriteLimiter.hit(ip)) {
    res.status(429).json({
      jsonrpc: "2.0",
      id: (req.body as { id?: unknown })?.id ?? null,
      error: { code: -32000, message: `Rate limit exceeded: ${tool} is limited to 20 calls/hour per IP.` },
    });
    return;
  }

  next();
}
