import { test } from "node:test";
import assert from "node:assert/strict";

test("buildPanelPrompt includes character descriptions and color mode", async () => {
  const { buildPanelPrompt } = await import("./pipeline.js");

  const prompt = buildPanelPrompt(
    { panel: 1, scene: "Hero fights villain in a dark alley at midnight", characters: ["Hero", "Villain"] },
    [
      { name: "Hero", role: "protagonist", appearance: "young man, red cape" },
      { name: "Villain", role: "antagonist", appearance: "tall figure, dark cloak" },
    ],
    "manga",
    "color",
  );

  assert.ok(prompt.includes("highly detailed"));
  assert.ok(prompt.includes("Hero: young man, red cape"));
  assert.ok(prompt.includes("Villain: tall figure, dark cloak"));
  assert.ok(prompt.includes("vibrant colors"));
  assert.ok(prompt.includes("manga style"));
});

test("buildPanelPrompt handles B&W mode", async () => {
  const { buildPanelPrompt } = await import("./pipeline.js");

  const prompt = buildPanelPrompt(
    { panel: 1, scene: "A dark room with a single candle", characters: ["Hero"] },
    [],
    "semi-realistic",
    "bw",
  );

  assert.ok(prompt.includes("grayscale"));
  assert.ok(prompt.includes("high contrast"));
  assert.ok(prompt.includes("semi-realistic"));
});

test("buildPanelPrompt includes dialogue and camera angle", async () => {
  const { buildPanelPrompt } = await import("./pipeline.js");

  const prompt = buildPanelPrompt(
    { panel: 1, scene: "Hero confronts villain", characters: ["Hero"], dialogue: "It's over!", cameraAngle: "low angle" },
    [{ name: "Hero", role: "protagonist", appearance: "young warrior" }],
    "western",
    "color",
  );

  assert.ok(prompt.includes("Camera angle: low angle"));
  assert.ok(prompt.includes("western comic style"));
  // Dialogue is no longer injected into image prompt — it's rendered as speech bubble overlay
  assert.ok(!prompt.includes("It's over"));
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
    const layout = pickLayout(n, null, "wide shot");
    for (const p of layout) {
      assert.ok(p.x >= 0 && p.x < 1, `x out of bounds for ${n} panels`);
      assert.ok(p.y >= 0 && p.y < 1, `y out of bounds for ${n} panels`);
      assert.ok(p.w > 0 && p.w <= 1, `w out of bounds for ${n} panels`);
      assert.ok(p.h > 0 && p.h <= 1, `h out of bounds for ${n} panels`);
    }
  }
});

test("pickLayout avoids repeating the same layout", async () => {
  const { pickLayout } = await import("./types.js");

  const first = pickLayout(3, null, "close-up");
  const second = pickLayout(3, first, "close-up");
  const k1 = first.map((l) => `${l.x},${l.y},${l.w},${l.h}`).join("|");
  const k2 = second.map((l) => `${l.x},${l.y},${l.w},${l.h}`).join("|");
  assert.notEqual(k1, k2, "Consecutive pages should get different layouts");
});

test("webtoonLayouts stacks full-width panels vertically", async () => {
  const { webtoonLayouts, webtoonDims } = await import("./pipeline.js");

  const layouts = webtoonLayouts(3);
  assert.equal(layouts.length, 3);
  for (const [i, l] of layouts.entries()) {
    assert.equal(l.x, 0);
    assert.equal(l.w, 1);
    assert.ok(Math.abs(l.y - i / 3) < 1e-9);
    assert.ok(Math.abs(l.h - 1 / 3) < 1e-9);
  }

  // Page height grows with panel count; width is fixed.
  const d2 = webtoonDims(2);
  const d4 = webtoonDims(4);
  assert.equal(d2.width, d4.width);
  assert.ok(d4.height > d2.height);
});

test("panelAltText combines scene, characters, dialogue, and sfx", async () => {
  const { panelAltText } = await import("./pipeline.js");

  const alt = panelAltText({
    panel: 1,
    scene: "Mia leaps across rooftops at sunset",
    characters: ["Mia", "Bob"],
    dialogue: "Almost there!",
    dialogue2: "Wait for me!",
    sfx: "WHOOSH",
  });

  assert.ok(alt.includes("Mia leaps across rooftops at sunset."));
  assert.ok(alt.includes("Characters: Mia, Bob."));
  assert.ok(alt.includes('"Almost there!"'));
  assert.ok(alt.includes('"Wait for me!"'));
  assert.ok(alt.includes("Sound effect: WHOOSH."));

  // Minimal panel: just the scene, normalized to end with a period.
  assert.equal(panelAltText({ panel: 1, scene: "An empty street", characters: [] }), "An empty street.");
});

test("estimateCost scales with panel count", async () => {
  const { estimateCost } = await import("./pipeline.js");
  // llmCost=0.005 + 4*0.001 = 0.009 → round → 0.01
  assert.equal(estimateCost(1, 4), 0.01);
  // llmCost=0.005 + 18*0.001 = 0.023 → round → 0.02
  assert.equal(estimateCost(5, 18), 0.02);
  // llmCost=0.005 + 40*0.001 = 0.045 → round → 0.05
  assert.equal(estimateCost(10, 40), 0.05);
});
