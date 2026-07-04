import * as mammoth from "mammoth";
import * as ExcelJS from "xlsx";

export type ExtractedFile = {
  name: string;
  type: string;
  content: string;
  size: number;
};

function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || "";
}

export async function extractPDF(buffer: Buffer): Promise<string> {
  const PDFParser = (await import("pdf2json")).default;
  return new Promise((resolve, reject) => {
    const parser = new PDFParser();
    parser.on("pdfParser_dataReady", (data: any) => {
      const text = data.Pages.map((page: any) =>
        page.Texts.map((t: any) =>
          decodeURIComponent(t.R.map((r: any) => r.T).join(""))
        ).join(" ")
      ).join("\n");
      resolve(text.trim() || "[No se pudo extraer texto del PDF]");
    });
    parser.on("pdfParser_dataError", (err: any) => {
      reject(new Error(`Error parsing PDF: ${err.parserError || err}`));
    });
    parser.parseBuffer(buffer);
  });
}

export async function extractDOCX(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

export function extractXLSX(buffer: Buffer): string {
  const workbook = ExcelJS.read(buffer, { type: "buffer" });
  let text = "";
  workbook.SheetNames.forEach((name) => {
    const sheet = workbook.Sheets[name];
    const json = ExcelJS.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    text += `\n--- Hoja: ${name} ---\n`;
    json.forEach((row) => {
      text += row.join(" | ") + "\n";
    });
  });
  return text;
}

export async function extractText(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const ext = getExtension(filename);

  switch (ext) {
    case "pdf":
      return extractPDF(buffer);
    case "docx":
      return extractDOCX(buffer);
    case "xlsx":
    case "xls":
      return extractXLSX(buffer);
    case "txt":
    case "md":
    case "csv":
      return buffer.toString("utf8");
    default:
      return `[Archivo ${filename} no procesable. Solo se admite PDF, DOCX, XLSX, TXT, MD, CSV.]`;
  }
}
