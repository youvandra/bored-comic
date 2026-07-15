import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";
import type { PageResult } from "./types.js";

export async function buildPdf(
  pages: PageResult[],
  workDir: string,
  jobId: string,
): Promise<string> {
  const pdfDoc = await PDFDocument.create();

  for (const page of pages) {
    const imagePath = join(workDir, `page-${page.page}.png`);
    if (!fs.existsSync(imagePath)) continue;

    const imageBytes = fs.readFileSync(imagePath);
    const pngImage = await pdfDoc.embedPng(imageBytes);

    const pdfPage = pdfDoc.addPage([pngImage.width, pngImage.height]);
    pdfPage.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: pngImage.width,
      height: pngImage.height,
    });
  }

  const pdfPath = join(workDir, "comic.pdf");
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(pdfPath, pdfBytes);

  return `/comics/${jobId}/comic.pdf`;
}
