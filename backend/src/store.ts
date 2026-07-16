// Persistent JSON-file store for characters, series, and job storyboards.
// This is the state behind the three stateful features: character persistence,
// series continuity, and revise_page. One JSON file per collection, written
// atomically (tmp + rename). Scale target is an ASP with thousands of records,
// not millions — a database can replace this behind the same interface later.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import type { StoredCharacter, StoredSeries, StoredJob, SeriesEpisode } from "./types.js";

function dataDir(baseDir?: string): string {
  return baseDir || config.dataDir;
}

function collectionPath(name: string, baseDir?: string): string {
  return path.join(dataDir(baseDir), `${name}.json`);
}

function load<T>(name: string, baseDir?: string): Record<string, T> {
  const file = collectionPath(name, baseDir);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, T>;
  } catch {
    return {};
  }
}

function save<T>(name: string, records: Record<string, T>, baseDir?: string): void {
  const dir = dataDir(baseDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = collectionPath(name, baseDir);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2));
  fs.renameSync(tmp, file);
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}

// A plain path segment — same shape rule storage.ts enforces for jobIds.
export function isValidId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id);
}

// ——— Characters ———

export function saveCharacter(char: StoredCharacter, baseDir?: string): void {
  const all = load<StoredCharacter>("characters", baseDir);
  all[char.characterId] = char;
  save("characters", all, baseDir);
}

export function getCharacter(characterId: string, baseDir?: string): StoredCharacter | null {
  if (!isValidId(characterId)) return null;
  return load<StoredCharacter>("characters", baseDir)[characterId] ?? null;
}

export function getCharacters(characterIds: string[], baseDir?: string): StoredCharacter[] {
  const all = load<StoredCharacter>("characters", baseDir);
  return characterIds.map((id) => all[id]).filter((c): c is StoredCharacter => !!c);
}

// ——— Series ———

export function saveSeries(series: StoredSeries, baseDir?: string): void {
  const all = load<StoredSeries>("series", baseDir);
  all[series.seriesId] = series;
  save("series", all, baseDir);
}

export function getSeries(seriesId: string, baseDir?: string): StoredSeries | null {
  if (!isValidId(seriesId)) return null;
  return load<StoredSeries>("series", baseDir)[seriesId] ?? null;
}

export function appendEpisode(seriesId: string, episode: Omit<SeriesEpisode, "episode">, baseDir?: string): SeriesEpisode | null {
  const all = load<StoredSeries>("series", baseDir);
  const series = all[seriesId];
  if (!series) return null;
  const full: SeriesEpisode = { ...episode, episode: series.episodes.length + 1 };
  series.episodes.push(full);
  series.updatedAt = new Date().toISOString();
  save("series", all, baseDir);
  return full;
}

// ——— Jobs ———

export function saveJob(job: StoredJob, baseDir?: string): void {
  const all = load<StoredJob>("jobs", baseDir);
  all[job.jobId] = job;
  pruneJobs(all);
  save("jobs", all, baseDir);
}

export function getJob(jobId: string, baseDir?: string): StoredJob | null {
  if (!isValidId(jobId)) return null;
  const job = load<StoredJob>("jobs", baseDir)[jobId];
  if (!job) return null;
  if (Date.now() - Date.parse(job.createdAt) > config.jobTtlMs) return null;
  return job;
}

// Drop jobs past their revision TTL so the collection can't grow unbounded.
function pruneJobs(all: Record<string, StoredJob>): void {
  const now = Date.now();
  for (const [id, job] of Object.entries(all)) {
    if (now - Date.parse(job.createdAt) > config.jobTtlMs) delete all[id];
  }
}

// ——— Character reference images ———

// Character sheets live under DATA_DIR/characters/<id>/ — persistent, unlike
// comic output which expires with COMIC_TTL_MS.
export function characterImageDir(characterId: string, baseDir?: string): string {
  return path.join(dataDir(baseDir), "characters", characterId);
}

export function resolveCharacterImagePath(characterId: string, file: string, baseDir?: string): string | null {
  if (!isValidId(characterId)) return null;
  const normalized = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, "");
  if (normalized.includes("..") || path.isAbsolute(normalized)) return null;

  const dir = dataDir(baseDir);
  const full = path.join(dir, "characters", characterId, normalized);
  const root = path.join(dir, "characters") + path.sep;
  if (!full.startsWith(root)) return null;
  if (!fs.existsSync(full)) return null;
  return full;
}
