import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("crc32 matches known vectors", async () => {
  const { crc32 } = await import("./cbz.js");
  // Standard test vector: CRC-32 of "123456789" is 0xCBF43926.
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(crc32(Buffer.from("")), 0);
});

test("buildZip produces a structurally valid ZIP", async () => {
  const { buildZip } = await import("./cbz.js");

  const zip = buildZip([
    { name: "a.txt", data: Buffer.from("hello") },
    { name: "b.txt", data: Buffer.from("world!") },
  ]);

  // Local file header signature at the start.
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  // End-of-central-directory signature in the last 22 bytes.
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  // Entry count recorded in EOCD.
  assert.equal(zip.readUInt16LE(zip.length - 22 + 10), 2);
  // Stored data is present verbatim (method 0 = no compression).
  assert.ok(zip.includes(Buffer.from("hello")));
  assert.ok(zip.includes(Buffer.from("world!")));
  assert.ok(zip.includes(Buffer.from("a.txt")));
});

test("buildCbz packs existing pages in reading order and skips missing files", async () => {
  const { buildCbz } = await import("./cbz.js");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boredcomic-cbz-"));
  fs.writeFileSync(path.join(dir, "cover.png"), "COVER");
  fs.writeFileSync(path.join(dir, "page-1.png"), "PAGE1");
  fs.writeFileSync(path.join(dir, "page-2.png"), "PAGE2");
  // no endcard.png — must be skipped, not crash

  const url = buildCbz(dir, "cg_test", [1, 2]);
  assert.equal(url, "/comics/cg_test/comic.cbz");

  const cbz = fs.readFileSync(path.join(dir, "comic.cbz"));
  assert.equal(cbz.readUInt32LE(0), 0x04034b50);
  assert.equal(cbz.readUInt16LE(cbz.length - 22 + 10), 3); // cover + 2 pages
  assert.ok(cbz.includes(Buffer.from("000-cover.png")));
  assert.ok(cbz.includes(Buffer.from("001-page.png")));
  assert.ok(cbz.includes(Buffer.from("002-page.png")));
  assert.ok(!cbz.includes(Buffer.from("999-end.png")));
});
