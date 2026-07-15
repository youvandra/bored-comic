import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import opentype from "opentype.js";

// sharp's bundled librsvg ignores custom fonts (both fontconfig and @font-face
// data URIs are no-ops here). So instead of SVG <text>, we convert lettering to
// vector <path> outlines using the actual glyph shapes from the bundled TTFs.
// This renders identically on any host and gives exact text metrics.
//
// assets/fonts sits at backend/assets/fonts, one level up from both src/ (tsx)
// and dist/ (compiled), so the relative path is identical either way.
const here = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(here, "..", "assets", "fonts");

function load(file: string): opentype.Font {
  // opentype v1 wants an ArrayBuffer.
  const buf = readFileSync(join(fontsDir, file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

export const bangers = load("Bangers-Regular.ttf");
export const comicNeue = load("ComicNeue-Bold.ttf");

export interface GlyphText {
  d: string; // SVG path data
  width: number; // exact advance width at this font size
}

// Build an SVG path for a single line. `cx` is the horizontal center; the
// baseline sits at `baselineY`.
export function linePath(font: opentype.Font, text: string, fontSize: number, cx: number, baselineY: number): GlyphText {
  const width = font.getAdvanceWidth(text, fontSize);
  const path = font.getPath(text, cx - width / 2, baselineY, fontSize);
  return { d: path.toPathData(2), width };
}

// Largest font size that fits `text` within `maxWidth` (capped at `maxSize`).
export function fitFontSize(font: opentype.Font, text: string, maxWidth: number, maxSize: number, minSize = 10): number {
  const wAt100 = font.getAdvanceWidth(text, 100);
  const size = Math.floor((maxWidth / wAt100) * 100);
  return Math.max(minSize, Math.min(maxSize, size));
}
