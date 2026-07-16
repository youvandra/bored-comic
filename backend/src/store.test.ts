import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "boredcomic-store-"));
}

test("saveCharacter/getCharacter round-trips", async () => {
  const { saveCharacter, getCharacter } = await import("./store.js");
  const dir = tmpDir();

  const char = {
    characterId: "ch_test1",
    name: "Mia",
    role: "protagonist",
    appearance: "16 years old, short pink hair, goggles",
    style: "manga" as const,
    seed: 12345,
    referenceUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveCharacter(char, dir);

  const loaded = getCharacter("ch_test1", dir);
  assert.ok(loaded);
  assert.equal(loaded.name, "Mia");
  assert.equal(loaded.seed, 12345);
});

test("getCharacter rejects malformed ids and unknown ids", async () => {
  const { getCharacter } = await import("./store.js");
  const dir = tmpDir();
  assert.equal(getCharacter("../etc/passwd", dir), null);
  assert.equal(getCharacter("nope", dir), null);
});

test("getCharacters returns only found records", async () => {
  const { saveCharacter, getCharacters } = await import("./store.js");
  const dir = tmpDir();
  const base = {
    role: "x",
    appearance: "someone with a face and clothes",
    style: "manga" as const,
    referenceUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveCharacter({ ...base, characterId: "ch_a", name: "A", seed: 1 }, dir);
  saveCharacter({ ...base, characterId: "ch_b", name: "B", seed: 2 }, dir);

  const found = getCharacters(["ch_a", "ch_missing", "ch_b"], dir);
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((c) => c.name), ["A", "B"]);
});

test("appendEpisode numbers episodes sequentially", async () => {
  const { saveSeries, appendEpisode, getSeries } = await import("./store.js");
  const dir = tmpDir();
  const now = new Date().toISOString();
  saveSeries({
    seriesId: "sr_test",
    title: "Test Saga",
    characterIds: [],
    episodes: [],
    createdAt: now,
    updatedAt: now,
  }, dir);

  const ep1 = appendEpisode("sr_test", { jobId: "cg_1", title: "Ep1", synopsis: "s", endingSummary: "hero wins", createdAt: now }, dir);
  const ep2 = appendEpisode("sr_test", { jobId: "cg_2", title: "Ep2", synopsis: "s", endingSummary: "villain returns", createdAt: now }, dir);

  assert.equal(ep1?.episode, 1);
  assert.equal(ep2?.episode, 2);
  const series = getSeries("sr_test", dir);
  assert.equal(series?.episodes.length, 2);
  assert.equal(series?.episodes[1].endingSummary, "villain returns");
});

test("appendEpisode returns null for unknown series", async () => {
  const { appendEpisode } = await import("./store.js");
  const dir = tmpDir();
  assert.equal(appendEpisode("sr_nope", { jobId: "x", title: "t", synopsis: "s", endingSummary: "e", createdAt: new Date().toISOString() }, dir), null);
});

test("saveJob/getJob round-trips; expired jobs return null", async () => {
  const { saveJob, getJob } = await import("./store.js");
  const dir = tmpDir();
  const now = new Date().toISOString();
  const job = {
    jobId: "cg_fresh",
    input: { prompt: "test", pages: 1 },
    storyboard: { title: "T", synopsis: "s", characters: [], pages: [] },
    seed: 42,
    pageW: 800,
    pageH: 1067,
    layoutMode: "page" as const,
    characterIds: [],
    createdAt: now,
    updatedAt: now,
  };
  saveJob(job, dir);
  assert.equal(getJob("cg_fresh", dir)?.seed, 42);

  // A job created past the TTL is treated as expired.
  saveJob({ ...job, jobId: "cg_old", createdAt: new Date(Date.now() - 8 * 86_400_000).toISOString() }, dir);
  assert.equal(getJob("cg_old", dir), null);
});

test("saveJob persists the delivery payload for get_job recovery", async () => {
  const { saveJob, getJob } = await import("./store.js");
  const dir = tmpDir();
  const now = new Date().toISOString();
  saveJob({
    jobId: "cg_delivery",
    input: { prompt: "test", pages: 1 },
    storyboard: { title: "T", synopsis: "s", characters: [], pages: [] },
    seed: 7,
    pageW: 800,
    pageH: 1067,
    layoutMode: "page" as const,
    characterIds: [],
    delivery: { jobId: "cg_delivery", title: "T", summary: "1-page test" } as never,
    createdAt: now,
    updatedAt: now,
  }, dir);

  const job = getJob("cg_delivery", dir);
  assert.equal((job?.delivery as { summary?: string } | undefined)?.summary, "1-page test");
});

test("collectionCount counts stored records", async () => {
  const { saveSeries, collectionCount } = await import("./store.js");
  const dir = tmpDir();
  assert.equal(collectionCount("series", dir), 0);
  const now = new Date().toISOString();
  saveSeries({ seriesId: "sr_1", title: "A", characterIds: [], episodes: [], createdAt: now, updatedAt: now }, dir);
  saveSeries({ seriesId: "sr_2", title: "B", characterIds: [], episodes: [], createdAt: now, updatedAt: now }, dir);
  assert.equal(collectionCount("series", dir), 2);
});

test("incrementViews counts per job and getViews reads back", async () => {
  const { incrementViews, getViews } = await import("./store.js");
  const dir = tmpDir();

  assert.equal(getViews("cg_v1", dir), 0);
  assert.equal(incrementViews("cg_v1", dir), 1);
  assert.equal(incrementViews("cg_v1", dir), 2);
  assert.equal(incrementViews("cg_v2", dir), 1);
  assert.equal(getViews("cg_v1", dir), 2);
  // Malformed ids never write.
  assert.equal(incrementViews("../evil", dir), 0);
});

test("resolveCharacterImagePath rejects traversal and unknown files", async () => {
  const { resolveCharacterImagePath, characterImageDir } = await import("./store.js");
  const dir = tmpDir();

  assert.equal(resolveCharacterImagePath("ch_x", "../secrets.txt", dir), null);
  assert.equal(resolveCharacterImagePath("../evil", "reference.png", dir), null);
  assert.equal(resolveCharacterImagePath("ch_x", "/etc/passwd", dir), null);
  assert.equal(resolveCharacterImagePath("ch_x", "reference.png", dir), null); // doesn't exist

  const imgDir = characterImageDir("ch_x", dir);
  fs.mkdirSync(imgDir, { recursive: true });
  fs.writeFileSync(path.join(imgDir, "reference.png"), "fake");
  const resolved = resolveCharacterImagePath("ch_x", "reference.png", dir);
  assert.ok(resolved?.endsWith(path.join("ch_x", "reference.png")));
});
