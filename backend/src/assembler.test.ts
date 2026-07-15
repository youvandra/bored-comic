import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPdf } from "./assembler.js";

// Minimal 1x1 white PNG
function minimalPng(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xD7, 0x63, 0x60, 0x60, 0x60, 0x00,
    0x00, 0x00, 0x04, 0x00, 0x01, 0x27, 0x34, 0x27,
    0x0A, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82,
  ]);
}

test("buildPdf creates a PDF from page images", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "bc-pdf-test-"));
  writeFileSync(join(tmpDir, "page-1.png"), minimalPng());
  writeFileSync(join(tmpDir, "page-2.png"), minimalPng());

  const pdfPath = await buildPdf(
    [
      { page: 1, panels: 2, storyBeat: "Start", imageUrl: "/x/page-1.png", evidence: { model: "test", promptChars: 10, characterCount: 1, caveat: "" } },
      { page: 2, panels: 3, storyBeat: "Middle", imageUrl: "/x/page-2.png", evidence: { model: "test", promptChars: 10, characterCount: 2, caveat: "" } },
    ],
    tmpDir,
    "test-job",
  );

  assert.ok(pdfPath.endsWith("comic.pdf"));
  assert.ok(pdfPath.startsWith("/comics/test-job/"));
});

test("buildPdf handles missing page images gracefully", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "bc-pdf-miss-"));
  // Only create page 1, not page 2
  writeFileSync(join(tmpDir, "page-1.png"), minimalPng());

  const pdfPath = await buildPdf(
    [
      { page: 1, panels: 2, storyBeat: "Start", imageUrl: "/x/page-1.png", evidence: { model: "test", promptChars: 10, characterCount: 1, caveat: "" } },
      { page: 2, panels: 3, storyBeat: "Missing", imageUrl: "/x/page-2.png", evidence: { model: "test", promptChars: 10, characterCount: 2, caveat: "" } },
    ],
    tmpDir,
    "test-job-2",
  );

  assert.ok(pdfPath.endsWith("comic.pdf"));
});

test("buildPdf returns empty path when no pages", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "bc-pdf-empty-"));
  const pdfPath = await buildPdf([], tmpDir, "test-job-3");
  assert.ok(pdfPath.endsWith("comic.pdf"));
});
