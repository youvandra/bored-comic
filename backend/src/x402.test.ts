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
