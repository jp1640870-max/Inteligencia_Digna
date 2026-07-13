import ExcelJS from "exceljs";
import type { CellEdit, RowInsertEdit, ColInsertEdit, RowDeleteEdit, ColDeleteEdit } from "@/types";

export type ExcelStructure = {
  sheets: {
    name: string;
    rows: { cell: string; value: string | number | null; type: string }[][];
    colCount: number;
    rowCount: number;
  }[];
};

export async function readExcelStructure(buffer: Buffer): Promise<ExcelStructure> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

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
  instructions: EditInstruction[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

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
        const colLetter = edit.afterCol.toUpperCase();
        const colIndex = colLetter.charCodeAt(0) - 64;
        const colName = String.fromCharCode(64 + colIndex + 1);
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
        const colIndex = edit.col.toUpperCase().charCodeAt(0) - 64;
        sheet.spliceColumns(colIndex, 1);
        break;
      }
    }
  }

  const bufferOut = await workbook.xlsx.writeBuffer();
  return Buffer.from(bufferOut);
}

type EditInstruction = { type: string; sheet?: string } & Record<string, unknown>;
