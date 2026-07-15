import { test } from "node:test";
import assert from "node:assert/strict";

test("buildPanelPrompt includes character descriptions and color mode", async () => {
  const { buildPanelPrompt } = await import("./pipeline.js");

  const prompt = buildPanelPrompt(
    { panel: 1, scene: "Hero fights villain", characters: ["Hero", "Villain"] },
    [
      { name: "Hero", role: "protagonist", appearance: "young man, red cape" },
      { name: "Villain", role: "antagonist", appearance: "tall figure, dark cloak" },
    ],
    "manga",
    "color",
  );

  assert.ok(prompt.includes("manga style"));
  assert.ok(prompt.includes("Hero: young man, red cape"));
  assert.ok(prompt.includes("full color, vibrant"));
  assert.ok(prompt.includes("Hero fights villain"));
});

test("buildPanelPrompt handles B&W mode", async () => {
  const { buildPanelPrompt } = await import("./pipeline.js");

  const prompt = buildPanelPrompt(
    { panel: 1, scene: "A dark room", characters: ["Unknown"] },
    [],
    "western",
    "bw",
  );

  assert.ok(prompt.includes("black and white, grayscale"));
  assert.ok(prompt.includes("western style"));
});

test("buildPanelPrompt includes dialogue", async () => {
  const { buildPanelPrompt } = await import("./pipeline.js");

  const prompt = buildPanelPrompt(
    { panel: 1, scene: "Hero speaks", characters: ["Hero"], dialogue: "I will save you!" },
    [{ name: "Hero", role: "protagonist", appearance: "young warrior" }],
    "manga",
    "color",
  );

  assert.ok(prompt.includes('saying: "I will save you!"'));
});

test("pickLayout returns correct number of panels", async () => {
  const { pickLayout } = await import("./types.js");

  assert.equal(pickLayout(1).length, 1);
  assert.equal(pickLayout(2).length, 2);
  assert.equal(pickLayout(3).length, 3);
  assert.equal(pickLayout(4).length, 4);
});

test("pickLayout positions are within bounds", async () => {
  const { pickLayout } = await import("./types.js");

  for (let n = 1; n <= 4; n++) {
    const layout = pickLayout(n);
    for (const p of layout) {
      assert.ok(p.x >= 0 && p.x < 1, `x out of bounds for ${n} panels`);
      assert.ok(p.y >= 0 && p.y < 1, `y out of bounds for ${n} panels`);
      assert.ok(p.w > 0 && p.w <= 1, `w out of bounds for ${n} panels`);
      assert.ok(p.h > 0 && p.h <= 1, `h out of bounds for ${n} panels`);
    }
  }
});

test("pickLayout returns different layouts for same count", async () => {
  const { pickLayout } = await import("./types.js");

  // 3-panel has 4 templates, calling 100 times should yield at least 2 different layouts
  const layouts = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const l = pickLayout(3);
    layouts.add(l.map((p) => `${p.x},${p.y},${p.w},${p.h}`).join("|"));
  }
  assert.ok(layouts.size >= 2, "Should produce multiple layout variants");
});

test("estimateCost computes fixed text cost", async () => {
  const { estimateCost } = await import("./pipeline.js");
  assert.equal(estimateCost(1, 4), 0.01);
  assert.equal(estimateCost(5, 18), 0.01);
  assert.equal(estimateCost(10, 40), 0.01);
});
