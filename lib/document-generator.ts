import ExcelJS from "exceljs";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  WidthType,
  AlignmentType,
} from "docx";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { DocGenStructure, DocGenFormat } from "@/types";

function getExtension(format: DocGenFormat): string {
  const map: Record<DocGenFormat, string> = {
    xlsx: "xlsx",
    docx: "docx",
    pdf: "pdf",
  };
  return map[format];
}

export async function generateDocument(
  structure: DocGenStructure
): Promise<{ buffer: Buffer; filename: string }> {
  const filename = structure.filename.endsWith(`.${getExtension(structure.format)}`)
    ? structure.filename
    : `${structure.filename}.${getExtension(structure.format)}`;

  switch (structure.format) {
    case "xlsx":
      return { buffer: await generateExcel(structure), filename };
    case "docx":
      return { buffer: await generateWord(structure), filename };
    case "pdf":
      return { buffer: await generatePdf(structure), filename };
    default:
      throw new Error(`Formato no soportado: ${structure.format}`);
  }
}

// ─── EXCEL ───────────────────────────────────────────────────────────────────

async function generateExcel(structure: DocGenStructure): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Inteligencia Digna";
  workbook.created = new Date();

  const sheets = structure.sheets || [{ name: "Sheet1", rows: [] }];

  for (const sheetData of sheets) {
    const sheet = workbook.addWorksheet(sheetData.name || "Sheet1");

    let rowOffset = 1;

    if (sheetData.headers && sheetData.headers.length > 0) {
      const headerRow = sheet.addRow(sheetData.headers);
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF4472C4" },
      };
      headerRow.alignment = { horizontal: "center", vertical: "middle" };
      headerRow.height = 22;
      rowOffset = 2;
    }

    for (const rowData of sheetData.rows) {
      const row = sheet.addRow(rowData);
      row.alignment = { vertical: "middle", wrapText: true };
    }

    const allRows = sheetData.rows;
    const totalRows = allRows.length + (sheetData.headers ? 1 : 0);
    if (totalRows > 0 && sheetData.headers) {
      const colCount = Math.max(
        sheetData.headers?.length || 0,
        ...allRows.map((r) => r.length)
      );
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: totalRows, column: colCount || 1 },
      };
    }

    const colCount = Math.max(
      sheetData.headers?.length || 0,
      ...allRows.map((r) => r.length)
    );
    const actualColCount = sheet.columnCount;
    for (let c = 1; c <= Math.max(colCount, actualColCount); c++) {
      const col = sheet.getColumn(c);
      let maxLen = 10;
      if (sheetData.headers && sheetData.headers[c - 1]) {
        maxLen = Math.max(maxLen, String(sheetData.headers[c - 1]).length + 2);
      }
      for (const row of allRows) {
        if (row[c - 1] !== undefined) {
          maxLen = Math.max(maxLen, String(row[c - 1]).length + 2);
        }
      }
      col.width = Math.min(maxLen, 60);
    }

    sheet.pageSetup.orientation = "landscape";
    sheet.pageSetup.fitToPage = true;
    sheet.pageSetup.fitToWidth = 1;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── WORD ────────────────────────────────────────────────────────────────────

async function generateWord(structure: DocGenStructure): Promise<Buffer> {
  const content = structure.content || [];
  const children: (Paragraph | Table)[] = [];

  for (const block of content) {
    switch (block.type) {
      case "title": {
        children.push(
          new Paragraph({
            text: block.text,
            heading: HeadingLevel.TITLE,
            spacing: { after: 300 },
            alignment: AlignmentType.CENTER,
          })
        );
        break;
      }
      case "heading": {
        const level = block.level || 1;
        const heading =
          level === 1 ? HeadingLevel.HEADING_1
          : level === 2 ? HeadingLevel.HEADING_2
          : level === 3 ? HeadingLevel.HEADING_3
          : HeadingLevel.HEADING_1;
        children.push(
          new Paragraph({
            text: block.text,
            heading,
            spacing: { before: 240, after: 120 },
          })
        );
        break;
      }
      case "paragraph": {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: block.text, size: 22 })],
            spacing: { after: 120 },
          })
        );
        break;
      }
      case "table": {
        const headers = block.headers || [];
        const rows = block.rows || [];

        const tableRows: TableRow[] = [];

        if (headers.length > 0) {
          tableRows.push(
            new TableRow({
              tableHeader: true,
              children: headers.map(
                (h) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({ text: h, bold: true, size: 20, color: "FFFFFF" }),
                        ],
                        alignment: AlignmentType.CENTER,
                      }),
                    ],
                    shading: { fill: "4472C4", type: "clear" },
                  })
              ),
            })
          );
        }

        for (const row of rows) {
          tableRows.push(
            new TableRow({
              children: row.map(
                (cell) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [new TextRun({ text: cell, size: 20 })],
                      }),
                    ],
                  })
              ),
            })
          );
        }

        children.push(
          new Table({
            rows: tableRows,
            width: { size: 100, type: WidthType.PERCENTAGE },
          })
        );

        children.push(new Paragraph({ spacing: { after: 200 } }));
        break;
      }
    }
  }

  const doc = new Document({
    creator: "Inteligencia Digna",
    title: structure.filename,
    sections: [{ children }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

async function generatePdf(structure: DocGenStructure): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const content = structure.content || [];

  const margin = 50;
  const pageWidth = 612;
  const pageHeight = 792;
  const usableWidth = pageWidth - margin * 2;
  const fontSize = 11;
  const lineHeight = fontSize * 1.4;

  function splitTextIntoLines(text: string, maxWidth: number): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      const width = font.widthOfTextAtSize(testLine, fontSize);
      if (width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) lines.push(line);
    return lines.length > 0 ? lines : [""];
  }

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  function addNewPageIfNeeded(needed: number) {
    if (y - needed < margin) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  }

  for (const block of content) {
    switch (block.type) {
      case "title": {
        const titleSize = 24;
        const titleLines = splitTextIntoLines(
          block.text,
          usableWidth,
        );
        addNewPageIfNeeded(titleLines.length * titleSize * 1.4 + 20);
        for (const line of titleLines) {
          const textWidth = boldFont.widthOfTextAtSize(line, titleSize);
          const x = margin + (usableWidth - textWidth) / 2;
          page.drawText(line, { x, y, size: titleSize, font: boldFont, color: rgb(0.2, 0.2, 0.2) });
          y -= titleSize * 1.4;
        }
        y -= 10;
        break;
      }
      case "heading": {
        const headSize = block.level === 1 ? 18 : block.level === 2 ? 14 : 12;
        const headLines = splitTextIntoLines(block.text, usableWidth);
        addNewPageIfNeeded(headLines.length * headSize * 1.4 + 10);
        for (const line of headLines) {
          page.drawText(line, { x: margin, y, size: headSize, font: boldFont, color: rgb(0.27, 0.45, 0.77) });
          y -= headSize * 1.4;
        }
        y -= 5;
        break;
      }
      case "paragraph": {
        const lines = splitTextIntoLines(block.text, usableWidth);
        addNewPageIfNeeded(lines.length * lineHeight + 5);
        for (const line of lines) {
          page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) });
          y -= lineHeight;
        }
        y -= 5;
        break;
      }
      case "table": {
        const headers = block.headers || [];
        const rows = block.rows || [];
        if (rows.length === 0) break;

        const colCount = Math.max(headers.length, ...rows.map((r) => r.length));
        const colWidth = usableWidth / colCount;

        const rowHeight = 24;
        const headerHeight = 26;
        const tableHeight = (headers.length > 0 ? headerHeight : 0) + rows.length * rowHeight + 5;

        addNewPageIfNeeded(tableHeight);

        const tableY = y;

        if (headers.length > 0) {
          let hx = margin;
          for (let c = 0; c < headers.length; c++) {
            page.drawRectangle({
              x: hx,
              y: tableY - headerHeight,
              width: colWidth,
              height: headerHeight,
              color: rgb(0.27, 0.45, 0.77),
            });
            const headerText = headers[c] || "";
            const textW = boldFont.widthOfTextAtSize(headerText, 9);
            page.drawText(headerText, {
              x: hx + (colWidth - textW) / 2,
              y: tableY - headerHeight + 7,
              size: 9,
              font: boldFont,
              color: rgb(1, 1, 1),
            });
            hx += colWidth;
          }

          for (let c = 0; c < headers.length; c++) {
            page.drawLine({
              start: { x: margin + c * colWidth, y: tableY - headerHeight },
              end: { x: margin + c * colWidth, y: tableY - headerHeight - rows.length * rowHeight },
              thickness: 0.5,
              color: rgb(0.7, 0.7, 0.7),
            });
          }
        }

        for (let r = 0; r < rows.length; r++) {
          const rowY = tableY - (headers.length > 0 ? headerHeight : 0) - (r + 1) * rowHeight;
          const row = rows[r];

          if (r % 2 === 1) {
            page.drawRectangle({
              x: margin,
              y: rowY,
              width: usableWidth,
              height: rowHeight,
              color: rgb(0.95, 0.95, 0.97),
            });
          }

          let cx = margin;
          for (let c = 0; c < colCount; c++) {
            const cellText = row[c] || "";
            page.drawText(cellText, {
              x: cx + 3,
              y: rowY + 5,
              size: 8,
              font,
              color: rgb(0.1, 0.1, 0.1),
            });
            cx += colWidth;
          }
        }

        const bottomY = tableY - (headers.length > 0 ? headerHeight : 0) - rows.length * rowHeight;
        page.drawLine({
          start: { x: margin, y: bottomY },
          end: { x: margin + usableWidth, y: bottomY },
          thickness: 0.5,
          color: rgb(0.7, 0.7, 0.7),
        });

        y = bottomY - 15;
        break;
      }
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
