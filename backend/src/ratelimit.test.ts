import { test } from "node:test";
import assert from "node:assert/strict";

test("SlidingLimiter allows up to the limit then blocks", async () => {
  const { SlidingLimiter } = await import("./ratelimit.js");
  const limiter = new SlidingLimiter(3, 60_000);

  assert.equal(limiter.hit("ip1"), true);
  assert.equal(limiter.hit("ip1"), true);
  assert.equal(limiter.hit("ip1"), true);
  assert.equal(limiter.hit("ip1"), false); // over limit
  assert.equal(limiter.hit("ip2"), true); // other keys unaffected
});

test("SlidingLimiter resets after the window expires", async () => {
  const { SlidingLimiter } = await import("./ratelimit.js");
  const limiter = new SlidingLimiter(1, 10); // 10ms window

  assert.equal(limiter.hit("ip"), true);
  assert.equal(limiter.hit("ip"), false);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(limiter.hit("ip"), true); // new window
});

test("sweep drops expired windows", async () => {
  const { SlidingLimiter } = await import("./ratelimit.js");
  const limiter = new SlidingLimiter(1, 10);
  limiter.hit("a");
  limiter.hit("b");
  await new Promise((r) => setTimeout(r, 15));
  limiter.sweep();
  // After sweep, both keys start fresh windows.
  assert.equal(limiter.hit("a"), true);
  assert.equal(limiter.hit("b"), true);
});
