import { test } from "node:test";
import assert from "node:assert/strict";

test("parseScore reads the judge's answer in common formats", async () => {
  const { parseScore } = await import("./vision.js");

  assert.equal(parseScore("Score: 8. Looks clean overall."), 8);
  assert.equal(parseScore("I'd rate this a 7 because the faces are consistent."), 7);
  assert.equal(parseScore("Rating: 10 — excellent composition"), 10);
  assert.equal(parseScore("This page is a solid 6/10, minor artifacts."), 6);
  assert.equal(parseScore("Quality is 9 out of 10"), 9);
});

test("parseScore returns null when no score is present", async () => {
  const { parseScore } = await import("./vision.js");
  assert.equal(parseScore("The image shows a cat on a roof."), null);
  assert.equal(parseScore(""), null);
});

test("parseScore prefers the labeled score over other digits", async () => {
  const { parseScore } = await import("./vision.js");
  assert.equal(parseScore("There are 3 characters. Score: 8."), 8);
});
