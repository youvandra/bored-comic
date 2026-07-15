import { test } from "node:test";
import assert from "node:assert/strict";

test("resolveComicPath rejects traversal attempts", async () => {
  const { resolveComicPath } = await import("./storage.js");
  assert.equal(resolveComicPath("job-1", "../page-1.png"), null);
  assert.equal(resolveComicPath("job-1", "../../etc/passwd"), null);
  assert.equal(resolveComicPath("job-1", "page-1.png"), null);
});

test("resolveComicPath rejects absolute paths", async () => {
  const { resolveComicPath } = await import("./storage.js");
  assert.equal(resolveComicPath("job-1", "/etc/passwd"), null);
});

test("resolveComicPath rejects null bytes", async () => {
  const { resolveComicPath } = await import("./storage.js");
  assert.equal(resolveComicPath("job-1", "page-1.png\u0000evil"), null);
});
