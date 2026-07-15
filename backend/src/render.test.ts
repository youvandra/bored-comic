import { test } from "node:test";
import assert from "node:assert/strict";

test("pageDims maps aspect ratios (default 3:4)", async () => {
  const { pageDims } = await import("./pipeline.js");
  assert.deepEqual(pageDims("3:4"), { width: 800, height: 1067 });
  assert.deepEqual(pageDims(undefined), { width: 800, height: 1067 });
  assert.deepEqual(pageDims("9:16"), { width: 800, height: 1422 });
  assert.deepEqual(pageDims("1:1"), { width: 900, height: 900 });
});

test("wrapText fits short text on one line, no ellipsis", async () => {
  const { wrapText } = await import("./pipeline.js");
  const lines = wrapText("hello world", 20, 2);
  assert.deepEqual(lines, ["hello world"]);
});

test("wrapText truncates at a word boundary with an ellipsis", async () => {
  const { wrapText } = await import("./pipeline.js");
  const lines = wrapText("one two three four five", 9, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines[lines.length - 1].endsWith("…"), "overflow line ends with ellipsis");
  // Never splits mid-word.
  assert.ok(lines.every((l) => !/\w…\w/.test(l)));
});

test("GENRE_GRADES stay subtle and directionally correct", async () => {
  const { GENRE_GRADES } = await import("./pipeline.js");

  for (const [genre, g] of Object.entries(GENRE_GRADES)) {
    assert.ok(g.saturation >= 0.6 && g.saturation <= 1.3, `${genre} saturation subtle`);
    assert.ok(g.brightness >= 0.85 && g.brightness <= 1.15, `${genre} brightness subtle`);
  }
  // Mood direction: horror drains, romance/comedy lift.
  assert.ok(GENRE_GRADES.horror.saturation < 1);
  assert.ok(GENRE_GRADES.horror.brightness < 1);
  assert.ok(GENRE_GRADES.romance.saturation > 1);
  assert.ok(GENRE_GRADES.comedy.brightness > 1);
  // No grade for neutral genres.
  assert.equal(GENRE_GRADES["slice-of-life"], undefined);
  assert.equal(GENRE_GRADES["manga"], undefined);
});

test("balloonType: exclamations shout, ellipsis thinks, tag wins for thought", async () => {
  const { balloonType } = await import("./pipeline.js");
  const pd = (dialogue: string, dialogueType?: "speech" | "shout" | "thought") =>
    ({ panel: 1, scene: "", characters: [], dialogue, dialogueType });

  assert.equal(balloonType(pd("Hello there")), "speech");
  assert.equal(balloonType(pd("Watch out!")), "shout");
  assert.equal(balloonType(pd("STOP")), "shout"); // all-caps
  assert.equal(balloonType(pd("hmm...")), "thought");
  assert.equal(balloonType(pd("quiet", "shout")), "shout");
  assert.equal(balloonType(pd("I wonder", "thought")), "thought");
  // Explicit thought is honored even over an exclamation.
  assert.equal(balloonType(pd("No way!", "thought")), "thought");
});
