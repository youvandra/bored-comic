import { test } from "node:test";
import assert from "node:assert/strict";

test("parseStoryboard extracts title, characters, and pages", async () => {
  const { parseStoryboard } = await import("./writer.js");

  const result = parseStoryboard(
    JSON.stringify({
      title: "Test Comic",
      synopsis: "A test",
      characters: [{ name: "Hero", role: "protagonist", appearance: "young warrior" }],
      pages: [
        {
          page: 1,
          panels: 3,
          storyBeat: "Hero appears",
          panelDescriptions: [
            { panel: 1, scene: "Hero stands", characters: ["Hero"], cameraAngle: "wide" },
            { panel: 2, scene: "Hero walks", characters: ["Hero"] },
            { panel: 3, scene: "Hero fights", characters: ["Hero"], dialogue: "Take that!" },
          ],
        },
      ],
    }),
    1,
  );

  assert.equal(result.title, "Test Comic");
  assert.equal(result.characters.length, 1);
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].panels, 3);
  assert.equal(result.pages[0].panelDescriptions.length, 3);
  assert.equal(result.pages[0].panelDescriptions[0].cameraAngle, "wide");
  assert.equal(result.pages[0].panelDescriptions[2].dialogue, "Take that!");
});

test("parseStoryboard accepts fewer pages without fabricating duplicates", async () => {
  const { parseStoryboard } = await import("./writer.js");

  const result = parseStoryboard(
    JSON.stringify({
      title: "Short",
      synopsis: "Short",
      characters: [{ name: "A", role: "protagonist", appearance: "person" }],
      pages: [
        {
          page: 1,
          panels: 2,
          storyBeat: "Start",
          panelDescriptions: [
            { panel: 1, scene: "Scene 1", characters: ["A"] },
            { panel: 2, scene: "Scene 2", characters: ["A"] },
          ],
        },
      ],
    }),
    5,
  );

  // Never pad with copied content — the actual page count is preserved and reported honestly.
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].page, 1);
  assert.equal(result.pages[0].storyBeat, "Start");
});

test("parseStoryboard truncates pages when input is longer", async () => {
  const { parseStoryboard } = await import("./writer.js");

  const result = parseStoryboard(
    JSON.stringify({
      title: "Long Story",
      synopsis: "Too long",
      characters: [{ name: "A", role: "protagonist", appearance: "person" }],
      pages: Array.from({ length: 10 }, (_, i) => ({
        page: i + 1,
        panels: 2,
        storyBeat: `Page ${i + 1}`,
        panelDescriptions: [
          { panel: 1, scene: `Scene ${i + 1}a`, characters: ["A"] },
          { panel: 2, scene: `Scene ${i + 1}b`, characters: ["A"] },
        ],
      })),
    }),
    3,
  );

  assert.equal(result.pages.length, 3);
  assert.equal(result.pages[0].page, 1);
  assert.equal(result.pages[2].page, 3);
});

test("parseStoryboard throws on invalid JSON", async () => {
  const { parseStoryboard } = await import("./writer.js");
  assert.throws(() => parseStoryboard("not json", 1));
});

test("parseStoryboard throws on missing title", async () => {
  const { parseStoryboard } = await import("./writer.js");
  assert.throws(
    () =>
      parseStoryboard(
        JSON.stringify({
          synopsis: "No title",
          characters: [],
          pages: [{ page: 1, panels: 1, storyBeat: "x", panelDescriptions: [] }],
        }),
        1,
      ),
    /missing title/,
  );
});

test("parseStoryboard throws on empty pages", async () => {
  const { parseStoryboard } = await import("./writer.js");
  assert.throws(
    () =>
      parseStoryboard(
        JSON.stringify({ title: "Empty", synopsis: "x", characters: [], pages: [] }),
        1,
      ),
    /missing title or pages/,
  );
});

test("applyFixedCast overwrites paraphrased appearance and re-adds dropped characters", async () => {
  const { applyFixedCast } = await import("./writer.js");

  const storyboard = {
    title: "T",
    synopsis: "s",
    characters: [
      { name: "mia", role: "hero", appearance: "a girl with pink-ish hair" }, // paraphrased + lowercased
      { name: "Extra", role: "side", appearance: "someone" },
    ],
    pages: [],
  };
  const canon = { name: "Mia", role: "protagonist", appearance: "16 years old, short messy pink hair, goggles on forehead" };
  const dropped = { name: "Bob", role: "robot", appearance: "boxy body, one wheel instead of a left leg" };

  const result = applyFixedCast(storyboard, [canon, dropped]);

  const mia = result.characters.find((c) => c.name === "Mia");
  assert.equal(mia?.appearance, canon.appearance); // canonical text restored
  assert.ok(result.characters.find((c) => c.name === "Bob")); // dropped char re-added
  assert.ok(result.characters.find((c) => c.name === "Extra")); // new side char kept
});

test("parseRevisedPage normalizes page number, panel count, and numbering", async () => {
  const { parseRevisedPage } = await import("./writer.js");

  const revised = parseRevisedPage(
    JSON.stringify({
      page: 99, // wrong — must be forced back to the requested page
      panels: 2,
      storyBeat: "New beat",
      panelDescriptions: [
        { panel: 7, scene: "Scene A", characters: ["Mia"] },
        { panel: 8, scene: "Scene B", characters: ["Mia"], dialogue: "Hi!" },
        { panel: 9, scene: "C", characters: [] },
        { panel: 10, scene: "D", characters: [] },
        { panel: 11, scene: "E — must be truncated", characters: [] },
      ],
    }),
    2,
  );

  assert.equal(revised.page, 2);
  assert.equal(revised.panelDescriptions.length, 4); // capped at renderer max
  assert.equal(revised.panels, 4);
  assert.deepEqual(revised.panelDescriptions.map((p) => p.panel), [1, 2, 3, 4]);
});

test("parseRevisedPage throws on missing panels", async () => {
  const { parseRevisedPage } = await import("./writer.js");
  assert.throws(() => parseRevisedPage(JSON.stringify({ page: 1, storyBeat: "x" }), 1), /missing panelDescriptions/);
});
