import ExcelJS from "exceljs";
import { Readable } from "stream";
import type { CellEdit, RowInsertEdit, ColInsertEdit, RowDeleteEdit, ColDeleteEdit } from "@/types";

export type ExcelStructure = {
  sheets: {
    name: string;
    rows: { cell: string; value: string | number | null; type: string }[][];
    colCount: number;
    rowCount: number;
  }[];
};

/** Convierte letras de columna ("A", "Z", "AA", "AZ"...) a índice 1-based. */
export function colLettersToIndex(letters: string): number {
  let index = 0;
  for (const ch of letters.toUpperCase()) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index;
}

/** Convierte un índice 1-based a letras de columna ("A", "Z", "AA"...). */
export function colIndexToLetters(index: number): string {
  let letters = "";
  let n = index;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export async function readExcelStructure(buffer: Buffer): Promise<ExcelStructure> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(Readable.from([buffer]));

  const structure: ExcelStructure = { sheets: [] };

  workbook.eachSheet((sheet) => {
    const rows: { cell: string; value: string | number | null; type: string }[][] = [];
    let rowCount = 0;
    let colCount = 0;

    sheet.eachRow((row, rowIndex) => {
      const cells: { cell: string; value: string | number | null; type: string }[] = [];
      row.eachCell((cell, colIndex) => {
        const address = cell.address as string;
        const value = cell.value;
        let displayValue: string | number | null = null;
        let type = "empty";

        if (value !== null && value !== undefined) {
          if (typeof value === "object" && "text" in value) {
            displayValue = (value as { text: string }).text;
            type = "richText";
          } else if (typeof value === "object" && "result" in value) {
            displayValue = String((value as { result: unknown }).result ?? "");
            type = "formula";
          } else {
            displayValue = String(value);
            type = typeof value;
          }
        }

        cells.push({ cell: address, value: displayValue, type });
        if (colIndex > colCount) colCount = colIndex;
      });
      rows.push(cells);
      if (rowIndex > rowCount) rowCount = rowIndex;
    });

    structure.sheets.push({
      name: sheet.name,
      rows,
      colCount,
      rowCount,
    });
  });

  return structure;
}

export async function applyExcelEdits(
  buffer: Buffer,
  instructions: ExcelEditInstruction[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(Readable.from([buffer]));

  for (const instruction of instructions) {
    const sheetName = instruction.sheet || workbook.worksheets[0]?.name;
    if (!sheetName) continue;
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) continue;

    switch (instruction.type) {
      case "modifyCell": {
        const edit = instruction as CellEdit & { type: "modifyCell" };
        const cell = sheet.getCell(edit.cell);
        cell.value = edit.value;
        break;
      }

      case "insertRow": {
        const edit = instruction as RowInsertEdit & { type: "insertRow" };
        const insertAt = edit.afterRow + 1;
        for (let r = 0; r < edit.values.length; r++) {
          sheet.spliceRows(insertAt + r, 0, edit.values[r]);
        }
        break;
      }

      case "insertCol": {
        const edit = instruction as ColInsertEdit & { type: "insertCol" };
        const colIndex = colLettersToIndex(edit.afterCol);
        sheet.spliceColumns(colIndex + 1, 0, [edit.header, ...edit.values]);
        break;
      }

      case "deleteRow": {
        const edit = instruction as RowDeleteEdit & { type: "deleteRow" };
        sheet.spliceRows(edit.row, 1);
        break;
      }

      case "deleteCol": {
        const edit = instruction as ColDeleteEdit & { type: "deleteCol" };
        const colIndex = colLettersToIndex(edit.col);
        sheet.spliceColumns(colIndex, 1);
        break;
      }
    }
  }

  const bufferOut = await workbook.xlsx.writeBuffer();
  return Buffer.from(bufferOut);
}

export type ExcelEditInstruction = { type: string; sheet?: string } & Record<string, unknown>;
