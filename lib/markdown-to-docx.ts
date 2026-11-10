import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
  type IStylesOptions,
  type INumberingOptions,
  type ParagraphChild,
  type FileChild,
} from "docx";
import { lexer, type Token, type Tokens } from "marked";

const FONT = "Arial";
const MONO_FONT = "Courier New";
const BODY_SIZE = 22; // 11 pt
const ORDERED_LIST_REFERENCE = "document-ordered-list";
const TABLE_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "D1D5DB" } as const;

export type DocumentDocxOptions = {
  markdown: string;
  title?: string;
  subtitle?: string;
  version?: string;
  date?: Date;
  author?: string;
  includeCover?: boolean;
  includeHeaderFooter?: boolean;
};

export type DocumentDocxResult = {
  buffer: Buffer;
  title: string;
  filename: string;
};

type InlineStyle = {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  color?: string;
  underline?: boolean;
  font?: string;
  size?: number;
  shading?: string;
};

type RenderContext = {
  listLevel: number;
  indent?: number;
  quote?: boolean;
  inlineStyle?: InlineStyle;
};

/**
 * Limpia caracteres que ni Word ni LibreOffice suelen renderizar bien
 * (emojis, selectores de variación y controles de C0). Conserva acentos,
 * flechas y símbolos matemáticos.
 */
export function sanitizeDocumentText(input: string): string {
  return String(input ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(
      /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]/gu,
      "",
    )
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/** Texto plano de una lista de tokens inline, útil para títulos y resúmenes. */
function plainText(tokens: Token[] | undefined): string {
  if (!tokens?.length) return "";
  return tokens
    .map((token) => {
      const value = token as Token & { tokens?: Token[]; text?: string };
      switch (token.type) {
        case "text":
          return value.tokens?.length ? plainText(value.tokens) : value.text ?? "";
        case "strong":
        case "em":
        case "del":
        case "link":
          return plainText(value.tokens);
        case "codespan":
        case "escape":
          return value.text ?? "";
        case "br":
          return " ";
        case "image":
          return value.text ?? "";
        default:
          return value.tokens?.length ? plainText(value.tokens) : value.text ?? "";
      }
    })
    .join("");
}

/** Extrae el primer H1 del Markdown; si no hay, el primer encabezado. */
export function extractMarkdownTitle(markdown: string): string | null {
  let firstHeading: string | null = null;
  for (const token of lexer(markdown)) {
    if (token.type !== "heading") continue;
    const text = plainText(token.tokens).trim();
    if (!text) continue;
    if (token.depth === 1) return text;
    if (!firstHeading) firstHeading = text;
  }
  return firstHeading;
}

/** Nombre de archivo seguro y sin acentos a partir del título. */
export function slugifyDocumentFilename(title: string, extension = "pdf"): string {
  const base = String(title ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const safeExtension = String(extension ?? "").replace(/[^a-z0-9]/gi, "") || "bin";
  return `${base || "documento"}.${safeExtension}`;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeForCompare(value: string): string {
  return sanitizeDocumentText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function headingLevel(depth: number) {
  if (depth <= 1) return HeadingLevel.HEADING_1;
  if (depth === 2) return HeadingLevel.HEADING_2;
  if (depth === 3) return HeadingLevel.HEADING_3;
  return HeadingLevel.HEADING_4;
}

function alignmentFor(align: Tokens.TableCell["align"] | undefined) {
  if (align === "center") return AlignmentType.CENTER;
  if (align === "right") return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function runOptions(style: InlineStyle) {
  return {
    bold: style.bold || undefined,
    italics: style.italics || undefined,
    strike: style.strike || undefined,
    color: style.color,
    font: style.font,
    size: style.size,
    underline: style.underline ? { type: UnderlineType.SINGLE } : undefined,
    shading: style.shading
      ? { type: ShadingType.CLEAR, fill: style.shading }
      : undefined,
  };
}

function renderInline(tokens: Token[] | undefined, style: InlineStyle = {}): ParagraphChild[] {
  if (!tokens?.length) return [];
  const runs: ParagraphChild[] = [];

  for (const token of tokens) {
    const value = token as Token & { tokens?: Token[]; text?: string; href?: string; title?: string | null };

    switch (token.type) {
      case "text":
        if (value.tokens?.length) {
          runs.push(...renderInline(value.tokens, style));
        } else {
          runs.push(new TextRun({ text: sanitizeDocumentText(value.text ?? ""), ...runOptions(style) }));
        }
        break;

      case "strong":
        runs.push(...renderInline(value.tokens, { ...style, bold: true }));
        break;

      case "em":
        runs.push(...renderInline(value.tokens, { ...style, italics: true }));
        break;

      case "del":
        runs.push(...renderInline(value.tokens, { ...style, strike: true }));
        break;

      case "codespan":
        runs.push(
          new TextRun({
            text: sanitizeDocumentText(value.text ?? ""),
            ...runOptions({
              ...style,
              font: MONO_FONT,
              size: Math.min(style.size ?? BODY_SIZE, 18),
              shading: "F3F4F6",
            }),
          }),
        );
        break;

      case "link": {
        const href = value.href ?? "";
        const link = /^(?:https?:\/\/|mailto:|#)/i.test(href) ? href : null;
        if (!link) {
          runs.push(
            new TextRun({
              text: sanitizeDocumentText(value.text ?? href),
              ...runOptions(style),
            }),
          );
          break;
        }

        const linkStyle: InlineStyle = { ...style, color: "0563C1", underline: true };
        const children = value.tokens?.length
          ? renderInline(value.tokens, linkStyle)
          : [new TextRun({ text: sanitizeDocumentText(value.text ?? link), ...runOptions(linkStyle) })];
        runs.push(
          new ExternalHyperlink({
            link,
            children,
          }),
        );
        break;
      }

      case "br":
        runs.push(new TextRun({ break: 1 }));
        break;

      case "image":
        runs.push(
          new TextRun({
            text: `[Imagen: ${sanitizeDocumentText(value.text ?? "sin descripción")}]`,
            ...runOptions({ ...style, italics: true, color: "6B7280" }),
          }),
        );
        break;

      case "html": {
        const text = stripHtml(value.text ?? "");
        if (text) {
          runs.push(new TextRun({ text: sanitizeDocumentText(text), ...runOptions(style) }));
        }
        break;
      }

      case "checkbox":
        runs.push(
          new TextRun({
            text: (token as Tokens.Checkbox).checked ? "[x] " : "[ ] ",
            ...runOptions({ ...style, bold: true }),
          }),
        );
        break;

      default:
        if (value.tokens?.length) {
          runs.push(...renderInline(value.tokens, style));
        } else if (value.text) {
          runs.push(new TextRun({ text: sanitizeDocumentText(value.text), ...runOptions(style) }));
        }
        break;
    }
  }

  return runs;
}

function renderParagraph(
  tokens: Token[] | undefined,
  context: RenderContext,
  fallbackText = "",
): Paragraph {
  const inlineStyle: InlineStyle = context.quote
    ? { ...context.inlineStyle, italics: true, color: "4B5563" }
    : context.inlineStyle ?? {};
  const children = tokens?.length
    ? renderInline(tokens, inlineStyle)
    : [new TextRun({ text: sanitizeDocumentText(fallbackText), ...runOptions(inlineStyle) })];

  return new Paragraph({
    children,
    indent: context.indent ? { left: context.indent } : undefined,
    border: context.quote
      ? { left: { style: BorderStyle.SINGLE, size: 12, color: "9CA3AF", space: 8 } }
      : undefined,
    shading: context.quote
      ? { type: ShadingType.CLEAR, fill: "F9FAFB" }
      : undefined,
    spacing: { after: 120 },
  });
}

function renderHeading(token: Tokens.Heading, context: RenderContext): Paragraph {
  return new Paragraph({
    heading: headingLevel(token.depth),
    children: renderInline(token.tokens, context.inlineStyle),
    indent: context.indent ? { left: context.indent } : undefined,
    spacing: {
      before: token.depth <= 1 ? 360 : 240,
      after: token.depth <= 1 ? 160 : 120,
    },
    keepNext: true,
  });
}

function renderCode(token: Tokens.Code, context: RenderContext): Paragraph {
  const lines = sanitizeDocumentText(token.text ?? "")
    .replace(/\n$/, "")
    .split("\n");
  const children: ParagraphChild[] = [];

  lines.forEach((line, index) => {
    if (index > 0) children.push(new TextRun({ break: 1 }));
    children.push(
      new TextRun({
        text: line || " ",
        font: MONO_FONT,
        size: 18,
        color: "111827",
      }),
    );
  });

  return new Paragraph({
    children,
    indent: { left: 180 + (context.indent ?? 0), right: 180 },
    shading: { type: ShadingType.CLEAR, fill: "F3F4F6" },
    border: {
      top: TABLE_BORDER,
      bottom: TABLE_BORDER,
      left: TABLE_BORDER,
      right: TABLE_BORDER,
    },
    spacing: { before: 120, after: 180 },
  });
}

function renderHr(): Paragraph {
  return new Paragraph({
    children: [],
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: "D1D5DB", space: 1 },
    },
    spacing: { before: 120, after: 180 },
  });
}

function renderTableCell(
  cell: Tokens.TableCell | undefined,
  header: boolean,
  align: Tokens.TableCell["align"] | undefined,
  striped: boolean,
): TableCell {
  const style: InlineStyle = {
    bold: header,
    size: 20,
    color: header ? "111827" : undefined,
  };
  const children = cell?.tokens?.length
    ? renderInline(cell.tokens, style)
    : [new TextRun({ text: sanitizeDocumentText(cell?.text ?? ""), ...runOptions(style) })];

  return new TableCell({
    shading: header
      ? { type: ShadingType.CLEAR, fill: "E5E7EB" }
      : striped
        ? { type: ShadingType.CLEAR, fill: "F9FAFB" }
        : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        children,
        alignment: alignmentFor(align),
        spacing: { after: 0 },
      }),
    ],
  });
}

function renderTable(token: Tokens.Table): Table {
  const columnCount = Math.max(
    token.header?.length ?? 0,
    ...token.rows.map((row) => row.length),
    1,
  );
  const usableWidth = 9360; // 6.5 in en twips
  const columnWidth = Math.max(800, Math.floor(usableWidth / columnCount));

  const headerRow = new TableRow({
    tableHeader: true,
    children: Array.from(
      { length: columnCount },
      (_, index) => renderTableCell(token.header?.[index], true, token.align?.[index], false),
    ),
  });

  const bodyRows = token.rows.map(
    (row, rowIndex) =>
      new TableRow({
        children: Array.from(
          { length: columnCount },
          (_, index) => renderTableCell(row[index], false, token.align?.[index], rowIndex % 2 === 1),
        ),
      }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: Array.from({ length: columnCount }, () => columnWidth),
    borders: {
      top: TABLE_BORDER,
      bottom: TABLE_BORDER,
      left: TABLE_BORDER,
      right: TABLE_BORDER,
      insideHorizontal: TABLE_BORDER,
      insideVertical: TABLE_BORDER,
    },
    rows: [headerRow, ...bodyRows],
  });
}

function renderList(
  token: Tokens.List,
  level: number,
  context: RenderContext,
): (Paragraph | Table)[] {
  const safeLevel = Math.min(level, 5);
  const out: (Paragraph | Table)[] = [];

  for (const item of token.items) {
    const blocks = item.tokens ?? [];
    let checkbox: Tokens.Checkbox | undefined;
    let firstBlock: Token | undefined;
    const rest: Token[] = [];

    for (const block of blocks) {
      if (!checkbox && !firstBlock && block.type === "checkbox") {
        checkbox = block as Tokens.Checkbox;
        continue;
      }
      if (!firstBlock && (block.type === "text" || block.type === "paragraph")) {
        firstBlock = block;
      } else {
        rest.push(block);
      }
    }

    const first = firstBlock as (Tokens.Text | Tokens.Paragraph) | undefined;
    const firstValue = first as (Token & { tokens?: Token[]; text?: string }) | undefined;
    const inlineTokens = firstValue?.tokens?.length ? firstValue.tokens : undefined;
    const fallback = firstValue?.text ?? item.text ?? "";
    const children: ParagraphChild[] = [];

    if (item.task) {
      const checked = item.checked ?? checkbox?.checked ?? false;
      children.push(new TextRun({ text: checked ? "[x] " : "[ ] ", bold: true }));
    }

    if (inlineTokens) {
      children.push(...renderInline(inlineTokens, context.inlineStyle));
    } else {
      children.push(new TextRun({ text: sanitizeDocumentText(fallback) }));
    }

    out.push(
      new Paragraph({
        children,
        ...(token.ordered
          ? { numbering: { reference: ORDERED_LIST_REFERENCE, level: safeLevel } }
          : { bullet: { level: safeLevel } }),
        spacing: { after: 60 },
      }),
    );

    for (const block of rest) {
      if (block.type === "list") {
        out.push(...renderList(block as Tokens.List, safeLevel + 1, context));
      } else {
        out.push(
          ...renderBlocks([block], {
            ...context,
            listLevel: safeLevel + 1,
            indent: 720 + safeLevel * 360,
          }),
        );
      }
    }
  }

  return out;
}

function renderBlocks(tokens: Token[], context: RenderContext): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "heading":
        out.push(renderHeading(token as Tokens.Heading, context));
        break;

      case "paragraph":
        out.push(renderParagraph(token.tokens, context, token.text));
        break;

      case "text":
        out.push(renderParagraph(token.tokens, context, token.text));
        break;

      case "list":
        out.push(...renderList(token as Tokens.List, context.listLevel, context));
        break;

      case "table":
        out.push(renderTable(token as Tokens.Table));
        out.push(new Paragraph({ children: [], spacing: { after: 120 } }));
        break;

      case "blockquote":
        out.push(
          ...renderBlocks((token as Tokens.Blockquote).tokens ?? [], {
            ...context,
            quote: true,
            inlineStyle: { ...context.inlineStyle, italics: true, color: "4B5563" },
          }),
        );
        break;

      case "code":
        out.push(renderCode(token as Tokens.Code, context));
        break;

      case "hr":
        out.push(renderHr());
        break;

      case "html": {
        const text = stripHtml(token.text ?? "");
        if (text) out.push(renderParagraph(undefined, context, text));
        break;
      }

      case "space":
      case "def":
        break;

      default: {
        const value = token as Token & { tokens?: Token[]; text?: string };
        if (value.tokens?.length) {
          out.push(...renderBlocks(value.tokens, context));
        } else if (value.text) {
          out.push(renderParagraph(undefined, context, value.text));
        }
        break;
      }
    }
  }

  return out;
}

function stripLeadingTitle(tokens: Token[], title: string): Token[] {
  const result = [...tokens];
  let index = 0;
  while (index < result.length && result[index].type === "space") index++;

  const first = result[index];
  if (first?.type === "heading" && first.depth === 1) {
    const text = plainText(first.tokens).trim();
    if (normalizeForCompare(text) === normalizeForCompare(title)) {
      result.splice(index, 1);
    }
  }

  return result;
}

function buildCover(
  title: string,
  subtitle: string | undefined,
  version: string,
  date: Date,
): Paragraph[] {
  return [
    new Paragraph({
      style: "CoverTitle",
      children: [new TextRun({ text: sanitizeDocumentText(title) })],
    }),
    ...(subtitle
      ? [
          new Paragraph({
            style: "CoverSubtitle",
            children: [new TextRun({ text: sanitizeDocumentText(subtitle) })],
          }),
        ]
      : []),
    new Paragraph({ style: "CoverRule", children: [] }),
    new Paragraph({
      style: "CoverMeta",
      children: [new TextRun({ text: `Versión ${sanitizeDocumentText(version)}` })],
    }),
    new Paragraph({
      style: "CoverMeta",
      children: [new TextRun({ text: formatDate(date) })],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function buildStyles(): IStylesOptions {
  return {
    default: {
      document: {
        run: { font: FONT, size: BODY_SIZE, color: "111827" },
        paragraph: { spacing: { line: 276, after: 120 } },
      },
      heading1: {
        run: { font: FONT, size: 32, bold: true, color: "0F172A" },
        paragraph: { spacing: { before: 360, after: 160 }, keepNext: true },
      },
      heading2: {
        run: { font: FONT, size: 26, bold: true, color: "1F2937" },
        paragraph: { spacing: { before: 280, after: 120 }, keepNext: true },
      },
      heading3: {
        run: { font: FONT, size: 23, bold: true, color: "374151" },
        paragraph: { spacing: { before: 220, after: 100 }, keepNext: true },
      },
      heading4: {
        run: { font: FONT, size: 22, bold: true, color: "4B5563" },
        paragraph: { spacing: { before: 180, after: 80 }, keepNext: true },
      },
    },
    paragraphStyles: [
      {
        id: "CoverTitle",
        name: "Cover Title",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: FONT, size: 56, bold: true, color: "0F172A" },
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { before: 2400, after: 240 },
        },
      },
      {
        id: "CoverSubtitle",
        name: "Cover Subtitle",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: FONT, size: 28, color: "4B5563" },
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
        },
      },
      {
        id: "CoverRule",
        name: "Cover Rule",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        paragraph: {
          alignment: AlignmentType.CENTER,
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 8, color: "D1D5DB", space: 1 },
          },
          spacing: { after: 240 },
        },
      },
      {
        id: "CoverMeta",
        name: "Cover Meta",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: FONT, size: 20, color: "6B7280" },
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
        },
      },
    ],
  };
}

function buildNumbering(): INumberingOptions {
  return {
    config: [
      {
        reference: ORDERED_LIST_REFERENCE,
        levels: Array.from({ length: 6 }, (_, level) => ({
          level,
          format: LevelFormat.DECIMAL,
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: {
            paragraph: {
              indent: { left: 720 + level * 360, hanging: 360 },
            },
          },
        })),
      },
    ],
  };
}

/**
 * Convierte Markdown GFM a un DOCX con portada, encabezado, pie de página,
 * estilos de encabezados, listas, tablas, citas y bloques de código.
 */
export async function buildDocumentDocx(options: DocumentDocxOptions): Promise<DocumentDocxResult> {
  const markdown = sanitizeDocumentText(options.markdown ?? "").trim();
  const date = options.date ?? new Date();
  const version = options.version?.trim() || "1.0";
  const includeCover = options.includeCover !== false;
  const includeHeaderFooter = options.includeHeaderFooter !== false;
  const tokens = lexer(markdown);
  const title =
    sanitizeDocumentText(
      options.title?.trim() || extractMarkdownTitle(markdown) || "Documento",
    ).trim() || "Documento";
  const bodyTokens = includeCover ? stripLeadingTitle(tokens, title) : tokens;
  const children: FileChild[] = [];

  if (includeCover) {
    children.push(...buildCover(title, options.subtitle, version, date));
  }

  const body = renderBlocks(bodyTokens, { listLevel: 0 });
  children.push(...body);

  if (!body.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: " " })] }));
  }

  const header = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 4, color: "E5E7EB", space: 4 },
        },
        children: [
          new TextRun({
            text: sanitizeDocumentText(title),
            size: 16,
            color: "9CA3AF",
          }),
        ],
      }),
    ],
  });

  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: "Página ", size: 16, color: "6B7280" }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "6B7280" }),
          new TextRun({ text: " de ", size: 16, color: "6B7280" }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "6B7280" }),
        ],
      }),
    ],
  });

  const document = new Document({
    creator: options.author || "Inteligencia Digna",
    title,
    description: options.subtitle || "",
    styles: buildStyles(),
    numbering: buildNumbering(),
    sections: [
      {
        properties: {
          ...(includeCover && includeHeaderFooter ? { titlePage: true } : {}),
          page: {
            size: { width: 12240, height: 15840 },
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
              header: 720,
              footer: 720,
            },
          },
        },
        headers: includeHeaderFooter
          ? {
              default: header,
              ...(includeCover ? { first: new Header({ children: [new Paragraph("")] }) } : {}),
            }
          : undefined,
        footers: includeHeaderFooter
          ? {
              default: footer,
              ...(includeCover ? { first: new Footer({ children: [new Paragraph("")] }) } : {}),
            }
          : undefined,
        children,
      },
    ],
  });

  const buffer = Buffer.from(await Packer.toBuffer(document));

  return {
    buffer,
    title,
    filename: slugifyDocumentFilename(title, "docx"),
  };
}
