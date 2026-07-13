import JSZip from "jszip";
import type { ParagraphEdit } from "@/types";

export type WordStructure = {
  paragraphs: {
    index: number;
    text: string;
    style?: string;
  }[];
};

export async function readWordStructure(buffer: Buffer): Promise<WordStructure> {
  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) throw new Error("No se encontró word/document.xml en el .docx");

  const paragraphs: WordStructure["paragraphs"] = [];
  const pRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  const tRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  const styleRegex = /<w:pStyle\s+w:val="([^"]+)"/;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pRegex.exec(docXml)) !== null) {
    const pTag = match[0];
    const texts: string[] = [];
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(pTag)) !== null) {
      texts.push(tMatch[1]);
    }
    const text = texts.join("").trim();
    const styleMatch = styleRegex.exec(pTag);
    const style = styleMatch ? styleMatch[1] : undefined;

    paragraphs.push({ index, text, style });
    index++;
  }

  return { paragraphs };
}

export async function applyWordEdits(
  buffer: Buffer,
  instructions: ParagraphEdit[]
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  let docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) throw new Error("No se encontró word/document.xml en el .docx");

  const pRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  const paragraphs: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pRegex.exec(docXml)) !== null) {
    paragraphs.push(match[0]);
  }

  const modifications: { index: number; newXml?: string; action: string }[] = [];

  for (const inst of instructions) {
    if (inst.paragraphIndex < 0 || inst.paragraphIndex >= paragraphs.length) continue;

    const originalXml = paragraphs[inst.paragraphIndex];

    switch (inst.action) {
      case "replaceText": {
        const tRegex = /(<w:t[^>]*>)[^<]*(<\/w:t>)/g;
        const newXml = originalXml.replace(tRegex, (_, open, close) => {
          return `${open}${escapeXml(inst.newText || "")}${close}`;
        });
        modifications.push({ index: inst.paragraphIndex, newXml, action: "replaceText" });
        break;
      }

      case "deleteParagraph": {
        modifications.push({ index: inst.paragraphIndex, action: "deleteParagraph" });
        break;
      }

      case "insertAfter": {
        const newParagraphXml = buildParagraphXml(inst.newText || "", paragraphs[inst.paragraphIndex]);
        modifications.push({ index: inst.paragraphIndex, action: "insertAfter", newXml: newParagraphXml });
        break;
      }
    }
  }

  modifications.sort((a, b) => b.index - a.index);

  for (const mod of modifications) {
    if (mod.action === "deleteParagraph") {
      paragraphs.splice(mod.index, 1);
    } else if (mod.action === "insertAfter") {
      paragraphs.splice(mod.index + 1, 0, mod.newXml!);
    } else if (mod.newXml) {
      paragraphs[mod.index] = mod.newXml;
    }
  }

  docXml = docXml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, () => paragraphs.shift() || "");

  zip.file("word/document.xml", docXml);
  const bufferOut = await zip.generateAsync({ type: "nodebuffer" });
  return Buffer.from(bufferOut);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildParagraphXml(text: string, referenceXml: string): string {
  const styleMatch = referenceXml.match(/<w:pStyle\s+w:val="([^"]+)"/);
  const styleAttr = styleMatch ? ` w:pStyle="${styleMatch[1]}"` : "";
  const pPrMatch = referenceXml.match(/<w:pPr[ >][\s\S]*?<\/w:pPr>/);
  const pPr = pPrMatch ? pPrMatch[0] : "";

  return `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
${pPr}
<w:r>
<w:t>${escapeXml(text)}</w:t>
</w:r>
</w:p>`;
}
