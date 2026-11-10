import { lexer, type Token, type Tokens } from "marked";
import { sanitizeDocumentText } from "@/lib/markdown-to-docx";
import { makePdfSafeText } from "@/lib/generated-document";
import type { DocGenContentBlock } from "@/types";

/**
 * Conversión de Markdown a los bloques que entiende el generador legacy de
 * pdf-lib.
 *
 * Es el fallback cuando LibreOffice no está disponible (`DOC_PDF_ENGINE=pdf-lib`
 * o binario ausente). No pretende conservar todo el formato: prioriza que el
 * PDF exista y sea legible, con títulos, párrafos, listas y tablas.
 */

function cleanText(value: string): string {
  return makePdfSafeText(sanitizeDocumentText(value ?? "")).trim();
}

function inlineText(tokens: Token[] | undefined): string {
  if (!tokens?.length) return "";
  return tokens
    .map((token) => {
      const value = token as Token & { tokens?: Token[]; text?: string };
      switch (token.type) {
        case "text":
          return value.tokens?.length ? inlineText(value.tokens) : value.text ?? "";
        case "strong":
        case "em":
        case "del":
        case "link":
          return inlineText(value.tokens);
        case "codespan":
        case "escape":
          return value.text ?? "";
        case "br":
          return " ";
        case "image":
          return value.text ? `[Imagen: ${value.text}]` : "";
        default:
          return value.tokens?.length ? inlineText(value.tokens) : value.text ?? "";
      }
    })
    .join("");
}

function listBlock(token: Tokens.List): DocGenContentBlock[] {
  const blocks: DocGenContentBlock[] = [];
  token.items.forEach((item, index) => {
    const text = cleanText(inlineText(item.tokens) || item.text || "");
    if (!text) return;
    const prefix = token.ordered ? `${(token.start || 1) + index}. ` : "• ";
    blocks.push({ type: "paragraph", text: `${prefix}${text}` });
  });
  return blocks;
}

function tableBlock(token: Tokens.Table): DocGenContentBlock {
  const headers = token.header.map((cell) => cleanText(inlineText(cell.tokens) || cell.text));
  const rows = token.rows.map((row) =>
    row.map((cell) => cleanText(inlineText(cell.tokens) || cell.text)),
  );
  return { type: "table", headers, rows };
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

export function markdownToDocGenBlocks(markdown: string, title?: string): DocGenContentBlock[] {
  const blocks: DocGenContentBlock[] = [];
  const safeTitle = cleanText(title ?? "");
  let hasTitle = false;

  if (safeTitle) {
    blocks.push({ type: "title", text: safeTitle });
    hasTitle = true;
  }

  const push = (block: DocGenContentBlock) => {
    if (block.type === "paragraph" && !block.text.trim()) return;
    if (block.type === "heading" && !block.text.trim()) return;
    if (block.type === "title" && !block.text.trim()) return;
    blocks.push(block);
  };

  const walk = (tokens: Token[]) => {
    for (const token of tokens) {
      switch (token.type) {
        case "heading": {
          const heading = token as Tokens.Heading;
          const text = cleanText(inlineText(heading.tokens) || heading.text);
          if (!text) break;
          if (!hasTitle && heading.depth === 1) {
            push({ type: "title", text });
            hasTitle = true;
          } else {
            push({ type: "heading", text, level: Math.min(3, Math.max(1, heading.depth)) });
          }
          break;
        }

        case "paragraph": {
          const paragraph = token as Tokens.Paragraph;
          push({ type: "paragraph", text: cleanText(inlineText(paragraph.tokens) || paragraph.text) });
          break;
        }

        case "text": {
          const text = token as Tokens.Text;
          push({ type: "paragraph", text: cleanText(inlineText(text.tokens) || text.text) });
          break;
        }

        case "list":
          for (const block of listBlock(token as Tokens.List)) push(block);
          break;

        case "table":
          push(tableBlock(token as Tokens.Table));
          break;

        case "blockquote":
          walk((token as Tokens.Blockquote).tokens ?? []);
          break;

        case "code": {
          const code = token as Tokens.Code;
          push({ type: "paragraph", text: cleanText(code.text) });
          break;
        }

        case "html": {
          const text = cleanText(stripHtml((token as Tokens.HTML).text ?? ""));
          if (text) push({ type: "paragraph", text });
          break;
        }

        case "space":
        case "hr":
        case "def":
          break;

        default: {
          const value = token as Token & { tokens?: Token[]; text?: string };
          if (value.tokens?.length) walk(value.tokens);
          else if (value.text) push({ type: "paragraph", text: cleanText(value.text) });
          break;
        }
      }
    }
  };

  walk(lexer(markdown || ""));

  if (blocks.length === 0) {
    blocks.push({ type: "paragraph", text: cleanText(markdown) || " " });
  }

  return blocks;
}
