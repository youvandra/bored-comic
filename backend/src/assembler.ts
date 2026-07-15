import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";
import type { PageResult } from "./types.js";

export async function buildPdf(
  pages: PageResult[],
  workDir: string,
  jobId: string,
  includeCover = false,
  title = "BoredComic",
): Promise<string> {
  const pdfDoc = await PDFDocument.create();

  // Document metadata — makes the file a proper comic book in readers/properties.
  pdfDoc.setTitle(title);
  pdfDoc.setAuthor("BoredComic");
  pdfDoc.setSubject("AI-generated comic");
  pdfDoc.setCreator("BoredComic (boredcomic.web.id)");
  pdfDoc.setProducer("BoredComic");
  pdfDoc.setCreationDate(new Date());

  const embed = async (imagePath: string): Promise<void> => {
    if (!fs.existsSync(imagePath)) return;
    const imageBytes = fs.readFileSync(imagePath);
    const pngImage = await pdfDoc.embedPng(imageBytes);
    const pdfPage = pdfDoc.addPage([pngImage.width, pngImage.height]);
    pdfPage.drawImage(pngImage, { x: 0, y: 0, width: pngImage.width, height: pngImage.height });
  };

  if (includeCover) await embed(join(workDir, "cover.png"));
  for (const page of pages) {
    await embed(join(workDir, `page-${page.page}.png`));
  }
  // "The End" back card, if the pipeline rendered one.
  await embed(join(workDir, "endcard.png"));

  const pdfPath = join(workDir, "comic.pdf");
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(pdfPath, pdfBytes);

  return `/comics/${jobId}/comic.pdf`;
}
