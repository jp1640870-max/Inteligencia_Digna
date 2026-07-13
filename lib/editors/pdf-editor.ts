import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { PdfTextEdit } from "@/types";

type PDFParserInstance = {
  new (): {
    on(event: string, cb: (data: any) => void): void;
    parseBuffer(buffer: Buffer): void;
  };
};

export type PdfStructure = {
  pages: {
    pageNumber: number;
    textItems: {
      text: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }[];
    width: number;
    height: number;
  }[];
};

export async function readPdfStructure(buffer: Buffer): Promise<PdfStructure> {
  const PDFParser = (await import("pdf2json")).default as unknown as PDFParserInstance;
  const pages: PdfStructure["pages"] = [];

  const text = await new Promise<string>((resolve, reject) => {
    const parser = new PDFParser();
    parser.on("pdfParser_dataReady", (data: any) => {
      resolve(JSON.stringify(data));
    });
    parser.on("pdfParser_dataError", (err: any) => {
      reject(new Error(`PDFParser error: ${err}`));
    });
    parser.parseBuffer(buffer);
  });

  const data = JSON.parse(text);

  for (let p = 0; p < (data.Pages || []).length; p++) {
    const page = data.Pages[p];
    const textItems: PdfStructure["pages"][0]["textItems"] = [];

    for (const item of page.Texts || []) {
      const decoded = item.R.map((r: any) =>
        decodeURIComponent(r.T)
      ).join("");

      textItems.push({
        text: decoded,
        x: item.x || 0,
        y: item.y || 0,
        w: item.w || 0,
        h: 12,
      });
    }

    pages.push({
      pageNumber: p + 1,
      textItems,
      width: page.Width || 612,
      height: page.Height || 792,
    });
  }

  return { pages };
}

export async function applyPdfEdits(
  buffer: Buffer,
  instructions: PdfTextEdit[]
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(buffer);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  for (const inst of instructions) {
    if (inst.pageNumber < 1 || inst.pageNumber > pages.length) continue;
    const page = pages[inst.pageNumber - 1];
    const { width, height } = page.getSize();

    // Use pdf2json to locate the old text position
    const structure = await readPdfStructure(buffer);
    const pageInfo = structure.pages.find((p) => p.pageNumber === inst.pageNumber);
    if (!pageInfo) continue;

    const matchedItem = pageInfo.textItems.find((item) =>
      item.text.includes(inst.oldText)
    );

    if (matchedItem) {
      // Convert pdf2json coordinates (bottom-left origin) to pdf-lib (bottom-left origin)
      const x = matchedItem.x;
      const y = height - matchedItem.y - matchedItem.h;

      // Draw white rectangle to cover old text
      page.drawRectangle({
        x: x - 1,
        y: y - 1,
        width: matchedItem.w + 2,
        height: matchedItem.h + 2,
        color: rgb(1, 1, 1),
      });

      // Draw new text in the same position
      page.drawText(inst.newText, {
        x,
        y,
        size: 11,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
