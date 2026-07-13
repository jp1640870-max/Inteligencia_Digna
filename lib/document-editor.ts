import type { EditFormat, EditInstruction, EditResult } from "@/types";
import { readExcelStructure, applyExcelEdits } from "@/lib/editors/excel-editor";
import { readWordStructure, applyWordEdits } from "@/lib/editors/word-editor";
import { readPdfStructure, applyPdfEdits } from "@/lib/editors/pdf-editor";
import { ollamaChat } from "@/lib/ollama";
import type { OllamaMessage } from "@/lib/ollama";

const MODEL = process.env.TEXT_MODEL || "llama3.2";

function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || "";
}

function formatAsFormat(ext: string): EditFormat | null {
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "docx") return "docx";
  if (ext === "pdf") return "pdf";
  return null;
}

export type EditDocumentResult = {
  result: EditResult;
  buffer?: Buffer;
};

export async function editDocument(
  buffer: Buffer,
  filename: string,
  instruction: string
): Promise<EditDocumentResult> {
  const ext = getExtension(filename);
  const format = formatAsFormat(ext);
  if (!format) {
    return {
      result: {
        success: false,
        format: ext as EditFormat,
        filename,
        originalName: filename,
        changesCount: 0,
        error: `Formato no soportado: .${ext}. Solo se admiten .xlsx, .docx y .pdf`,
      },
    };
  }

  try {
    let structureJson: string;
    let appliedChanges: number;
    let bufferOut: Buffer;

    if (format === "xlsx") {
      const structure = await readExcelStructure(buffer);
      structureJson = JSON.stringify(structure, null, 2);
      const parsed = await getEditInstructions(format, structureJson, instruction, "xlsx");
      bufferOut = await applyExcelEdits(buffer, parsed.changes as any[]);
      appliedChanges = parsed.changes.length;
    } else if (format === "docx") {
      const structure = await readWordStructure(buffer);
      structureJson = JSON.stringify(structure, null, 2);
      const parsed = await getEditInstructions(format, structureJson, instruction, "docx");
      bufferOut = await applyWordEdits(buffer, parsed.changes as any[]);
      appliedChanges = parsed.changes.length;
    } else if (format === "pdf") {
      const structure = await readPdfStructure(buffer);
      structureJson = JSON.stringify(structure, null, 2);
      const parsed = await getEditInstructions(format, structureJson, instruction, "pdf");
      bufferOut = await applyPdfEdits(buffer, parsed.changes as any[]);
      appliedChanges = parsed.changes.length;
    } else {
      return {
        result: {
          success: false,
          format,
          filename,
          originalName: filename,
          changesCount: 0,
          error: "Formato no implementado",
        },
      };
    }

    return {
      result: buildResult(format, filename, bufferOut, appliedChanges),
      buffer: bufferOut,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      result: {
        success: false,
        format: format!,
        filename,
        originalName: filename,
        changesCount: 0,
        error: msg,
      },
    };
  }
}

async function getEditInstructions(
  format: EditFormat,
  structureJson: string,
  instruction: string,
  schemaType: string
): Promise<{ changes: unknown[] }> {
  const systemPrompt = buildSystemPrompt(format, schemaType);
  const userPrompt = buildUserPrompt(format, structureJson, instruction);

  const messages: OllamaMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const response = await ollamaChat(MODEL, messages);
  const cleaned = extractJson(response);
  const parsed = JSON.parse(cleaned);

  if (!parsed.changes || !Array.isArray(parsed.changes)) {
    throw new Error("La IA no devolvió cambios válidos");
  }

  return { changes: parsed.changes };
}

function buildSystemPrompt(format: EditFormat, schemaType: string): string {
  const schemas: Record<string, string> = {
    xlsx: `TIPO DE CAMBIO (usa type):
- "modifyCell" → { type, sheet?, cell: "A1", value }
- "insertRow" → { type, sheet?, afterRow: número, values: [[fila1], [fila2]] }
- "insertCol" → { type, sheet?, afterCol: "C", header: "Título", values: [val1, val2] }
- "deleteRow" → { type, sheet?, row: número }
- "deleteCol" → { type, sheet?, col: "D" }`,
    docx: `TIPO DE CAMBIO (usa action):
- { paragraphIndex: número, action: "replaceText", newText: "texto nuevo" }
- { paragraphIndex: número, action: "deleteParagraph" }
- { paragraphIndex: número, action: "insertAfter", newText: "texto a insertar" }`,
    pdf: `TIPO DE CAMBIO:
- { pageNumber: número, oldText: "texto exacto a reemplazar", newText: "texto nuevo" }`,
  };

  return `Eres un asistente de edición de documentos.
El usuario quiere modificar un archivo ${format.toUpperCase()}.
Recibes la estructura actual del archivo y una instrucción de edición.

DEBES devolver SOLO JSON válido (sin markdown, sin explicaciones) con esta estructura:
{
  "changes": [ ...array de cambios según el tipo de archivo... ]
}

${schemas[schemaType] || ""}

REGLAS IMPORTANTES:
- No inventes datos que no estén en el documento original.
- Preserva el formato existente.
- Usa índices de párrafos/filas exactos.
- Para fechas: usa SOLO fechas que aparezcan en el documento o que el usuario proporcione explícitamente. NO inventes fechas.
- Si el usuario pide algo que no se puede hacer (ej: tabla en PDF), indícalo en "description".
- Responde ÚNICAMENTE con el JSON.`;
}

function buildUserPrompt(format: EditFormat, structureJson: string, instruction: string): string {
  return `Archivo: ${format.toUpperCase()}

ESTRUCTURA ACTUAL DEL ARCHIVO:
${structureJson.slice(0, 8000)}

INSTRUCCIÓN DEL USUARIO:
${instruction}

Devuelve SOLO el JSON con los cambios necesarios.`;
}

function extractJson(text: string): string {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1) {
    return text.slice(start, end + 1);
  }

  throw new Error("No se encontró JSON en la respuesta de la IA");
}

function buildResult(
  format: EditFormat,
  originalName: string,
  buffer: Buffer,
  changesCount: number
): EditResult {
  return {
    success: true,
    format,
    filename: `modificado_${originalName}`,
    originalName,
    changesCount,
  };
}
