import { test } from "node:test";
import assert from "node:assert/strict";

test("priceForPages applies 1x/2x/3x page tiers", async () => {
  const { priceForPages } = await import("./x402.js");

  const p1 = Number(priceForPages(1));
  const p3 = Number(priceForPages(3));
  const p4 = Number(priceForPages(4));
  const p6 = Number(priceForPages(6));
  const p7 = Number(priceForPages(7));
  const p10 = Number(priceForPages(10));

  assert.ok(p1 > 0, "base price must be positive");

  // Same tier → same price.
  assert.equal(p1, p3);
  assert.equal(p4, p6);
  assert.equal(p7, p10);

  // Tiers scale 1x / 2x / 3x off the base (independent of the base value).
  assert.equal(Math.round((p4 / p1) * 100) / 100, 2);
  assert.equal(Math.round((p7 / p1) * 100) / 100, 3);
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
