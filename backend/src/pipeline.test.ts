import { test } from "node:test";
import assert from "node:assert/strict";

test("buildPanelPrompt includes character descriptions", async () => {
  const { buildPanelPrompt } = await import("./pipeline.js");

  const prompt = buildPanelPrompt(
    { panel: 1, scene: "Hero fights villain", characters: ["Hero", "Villain"] },
    [
      { name: "Hero", role: "protagonist", appearance: "young man, red cape" },
      { name: "Villain", role: "antagonist", appearance: "tall figure, dark cloak" },
    ],
    "manga",
  );

  assert.ok(prompt.includes("manga style"));
  assert.ok(prompt.includes("Hero: young man, red cape"));
  assert.ok(prompt.includes("Villain: tall figure, dark cloak"));
  assert.ok(prompt.includes("Hero fights villain"));
});

test("buildPanelPrompt handles missing character references", async () => {
  const { buildPanelPrompt } = await import("./pipeline.js");

  const prompt = buildPanelPrompt(
    { panel: 1, scene: "A dark room", characters: ["Unknown"], dialogue: "Hello" },
    [],
    "western",
  );

  assert.ok(prompt.includes("western style"));
  assert.ok(prompt.includes("Unknown"));
  assert.ok(prompt.includes("Dialogue: Hello"));
});

test("estimateCost computes reasonable values", async () => {
  const { estimateCost } = await import("./pipeline.js");
  assert.equal(estimateCost(1, 4), 0.02);
  assert.equal(estimateCost(5, 18), 0.06);
  assert.equal(estimateCost(10, 40), 0.13);
});
