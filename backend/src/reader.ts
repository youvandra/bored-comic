// Hosted web reader: every delivery gets a shareable page at /read/:jobId.
// OG meta tags are injected server-side (crawlers don't run JS), so a shared
// link unfurls with the comic's cover and title. Each page view increments the
// job's view counter — the audience signal get_series feeds back to agents.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import type { StoredJob } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "frontend", "reader.html");

let templateCache: string | null = null;
function template(): string {
  if (templateCache === null || config.nodeEnv === "development") {
    templateCache = fs.readFileSync(TEMPLATE_PATH, "utf8");
  }
  return templateCache;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Safe to embed inside a <script type="application/json"> block: escaping the
// angle bracket prevents `</script>` breakouts from LLM-authored strings.
export function escapeJsonForScript(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, "\\u003c");
}

export function readerUrlFor(jobId: string): string {
  return `${config.publicBaseUrl}/read/${jobId}`;
}

export interface ReaderRenderInput {
  job: StoredJob;
  views: number;
  filesAvailable: boolean;
}

export function renderReaderPage({ job, views, filesAvailable }: ReaderRenderInput): string {
  const d = job.delivery;
  const title = d?.title || job.storyboard.title || "Untitled";
  const synopsis = job.storyboard.synopsis || d?.summary || "An AI-generated comic.";
  const coverUrl = `${config.publicBaseUrl}${d?.coverUrl || `/comics/${job.jobId}/cover.png`}`;

  const payload = {
    title,
    filesAvailable,
    coverUrl: d?.coverUrl || `/comics/${job.jobId}/cover.png`,
    pageUrls: d?.pageUrls || [],
    stripUrl: d?.stripUrl,
  };

  return template()
    .replaceAll("%%TITLE%%", escapeHtml(title))
    .replaceAll("%%SUMMARY%%", escapeHtml(synopsis))
    .replaceAll("%%COVER_URL%%", escapeHtml(coverUrl))
    .replaceAll("%%READER_URL%%", escapeHtml(readerUrlFor(job.jobId)))
    .replaceAll("%%GENRE%%", escapeHtml((d?.genre || job.input.genre || "comic").toUpperCase()))
    .replaceAll("%%STYLE%%", escapeHtml((d?.style || job.input.style || "manga").toUpperCase()))
    .replaceAll("%%VIEWS%%", String(views))
    .replaceAll("%%PAYLOAD%%", escapeJsonForScript(payload));
}
