import { test } from "node:test";
import assert from "node:assert/strict";

test("priceForPages is flat regardless of page count", async () => {
  const { priceForPages } = await import("./x402.js");

  const p1 = Number(priceForPages(1));

  assert.ok(p1 > 0, "base price must be positive");

  // The marketplace registers one fixed fee per service, so every page count
  // must resolve to the same price.
  for (const pages of [1, 3, 4, 6, 7, 10]) {
    assert.equal(Number(priceForPages(pages)), p1);
  }
});

test("priceForPages returns a 2-decimal string", async () => {
  const { priceForPages } = await import("./x402.js");
  assert.match(priceForPages(1), /^\d+\.\d{2}$/);
});

test("priceForTool: free tools are null, paid tools priced", async () => {
  const { priceForTool, priceForPages } = await import("./x402.js");

  // Free and unknown tools are not metered.
  assert.equal(priceForTool("get_quota", undefined), null);
  assert.equal(priceForTool("clarify_comic", undefined), null);
  assert.equal(priceForTool("get_character", undefined), null);
  assert.equal(priceForTool("get_series", undefined), null);
  assert.equal(priceForTool("create_series", undefined), null);
  assert.equal(priceForTool("unknown_tool", undefined), null);

  // generate_comic scales with pages.
  assert.equal(priceForTool("generate_comic", { pages: 2 }), priceForPages(2));
  assert.equal(priceForTool("generate_comic", { pages: 8 }), priceForPages(8));
  assert.equal(priceForTool("generate_comic", {}), priceForPages(1)); // schema guarantees pages; default to base

  // Single-generation tools cost the base rate.
  assert.equal(priceForTool("revise_page", undefined), priceForPages(1));
  assert.equal(priceForTool("create_character", undefined), priceForPages(1));
});
