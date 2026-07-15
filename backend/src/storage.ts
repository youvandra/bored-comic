import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export function resolveComicPath(jobId: string, file: string): string | null {
  const normalized = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, "");
  if (normalized.includes("..")) return null;

  const full = path.join(config.comicDir, jobId, normalized);
  if (!full.startsWith(config.comicDir)) return null;
  if (!fs.existsSync(full)) return null;

  return full;
}

export function startCleanup(): void {
  setInterval(() => {
    const now = Date.now();
    try {
      if (!fs.existsSync(config.comicDir)) return;
      for (const entry of fs.readdirSync(config.comicDir)) {
        const dir = path.join(config.comicDir, entry);
        const stat = fs.statSync(dir);
        if (stat.isDirectory() && now - stat.mtimeMs > config.comicTtlMs) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    } catch {
      // cleanup errors are non-fatal
    }
  }, 60_000).unref();
}
