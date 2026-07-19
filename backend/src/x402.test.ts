import { test } from "node:test";
import assert from "node:assert/strict";

test("preflightError: generate_comic accepts valid input", async () => {
  const { preflightError } = await import("./x402.js");
  const err = preflightError("generate_comic", { prompt: "a cat", pages: 5 }, 10);
  assert.equal(err, null);
});

test("preflightError: generate_comic rejects short prompt", async () => {
  const { preflightError } = await import("./x402.js");
  const err = preflightError("generate_comic", { prompt: "ab", pages: 5 }, 10);
  assert.ok(err?.includes("prompt"));
});

test("preflightError: generate_comic rejects pages over maxPages", async () => {
  const { preflightError } = await import("./x402.js");
  const err = preflightError("generate_comic", { prompt: "a cat", pages: 10 }, 5);
  assert.ok(err?.includes("pages must be an integer between"));
});

test("preflightError: generate_comic respects tier maxPages", async () => {
  const { preflightError } = await import("./x402.js");
  const basic = preflightError("generate_comic", { prompt: "a cat", pages: 5 }, 5);
  assert.equal(basic, null);
  const standard = preflightError("generate_comic", { prompt: "a cat", pages: 10 }, 10);
  assert.equal(standard, null);
  const premium = preflightError("generate_comic", { prompt: "a cat", pages: 20 }, 20);
  assert.equal(premium, null);
});

test("preflightError: revise_page validates required fields", async () => {
  const { preflightError } = await import("./x402.js");
  const err = preflightError("revise_page", { jobId: "nonexistent", page: 1, instruction: "test" }, 10);
  assert.ok(err?.includes("jobId"));
});

test("preflightError: create_character validates required fields", async () => {
  const { preflightError } = await import("./x402.js");
  const err = preflightError("create_character", { name: "", appearance: "short" }, 10);
  assert.ok(err?.includes("name"));
});

test("preflightError: unknown tool returns null", async () => {
  const { preflightError } = await import("./x402.js");
  assert.equal(preflightError("unknown_tool", {}, 10), null);
});
