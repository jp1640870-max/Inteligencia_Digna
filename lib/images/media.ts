import { createHash } from "node:crypto";

import type { ImageReferenceInput } from "@/types";

export type ImageMime = "image/png" | "image/jpeg" | "image/webp";

export type DecodedImage = {
  buffer: Buffer;
  mime: ImageMime;
  extension: "png" | "jpg" | "webp";
  width: number;
  height: number;
  bytes: number;
  checksumSha256: string;
};

const MIME_BY_EXTENSION: Record<string, ImageMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const EXTENSION_BY_MIME: Record<ImageMime, DecodedImage["extension"]> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function normalizeMime(value: string | undefined): ImageMime | null {
  if (!value) return null;
  const mime = value.trim().toLowerCase().split(";")[0];
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/jpg") {
    return mime === "image/jpg" ? "image/jpeg" : mime;
  }
  if (mime === "image/webp") return "image/webp";
  return null;
}

function sniffMime(buffer: Buffer): ImageMime | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function pngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = buffer[offset + 1];
    offset += 2;
    while (marker === 0xff) {
      marker = buffer[offset] ?? 0;
      offset += 1;
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && length >= 7) {
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      if (width > 0 && height > 0) return { width, height };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 30) return null;
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8 " && buffer.length >= 30) {
    const start = 20;
    if (buffer[start + 3] !== 0x9d || buffer[start + 4] !== 0x01 || buffer[start + 5] !== 0x2a) {
      return null;
    }
    return {
      width: buffer.readUInt16LE(start + 6) & 0x3fff,
      height: buffer.readUInt16LE(start + 8) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && buffer.length >= 25) {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  return null;
}

export function imageDimensions(buffer: Buffer, mime: ImageMime): { width: number; height: number } | null {
  if (mime === "image/png") return pngDimensions(buffer);
  if (mime === "image/jpeg") return jpegDimensions(buffer);
  return webpDimensions(buffer);
}

export type DecodeImageOptions = {
  maxBytes: number;
  maxDimension: number;
  requireDimensions?: boolean;
};

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageValidationError";
  }
}

/**
 * Decodifica un archivo subido (data URL o base64 crudo), valida el contenido
 * real por magic bytes y obtiene dimensiones sin decodificar la imagen entera.
 */
export function decodeImageInput(
  input: ImageReferenceInput,
  options: DecodeImageOptions,
): DecodedImage {
  const raw = String(input.data || "").trim();
  if (!raw) throw new ImageValidationError("La imagen está vacía.");

  let mimeHint = input.mime;
  let payload = raw;
  const dataUrl = /^data:([^;,]+)?(?:;base64)?,([\s\S]*)$/i.exec(raw);
  if (dataUrl) {
    mimeHint = mimeHint || dataUrl[1];
    payload = dataUrl[2];
  } else {
    const comma = raw.indexOf(",");
    if (comma > 0 && raw.slice(0, comma).includes("base64")) {
      payload = raw.slice(comma + 1);
    }
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(payload.replace(/\s+/g, ""), "base64");
  } catch {
    throw new ImageValidationError("La imagen no tiene una codificación base64 válida.");
  }
  if (buffer.length === 0) throw new ImageValidationError("La imagen está vacía.");
  if (buffer.length > options.maxBytes) {
    throw new ImageValidationError(
      `La imagen supera el límite de ${Math.round(options.maxBytes / 1024 / 1024)} MB.`,
    );
  }

  const sniffed = sniffMime(buffer);
  const hinted = normalizeMime(mimeHint);
  const mime = sniffed || hinted;
  if (!mime) {
    throw new ImageValidationError("El archivo no es una imagen PNG, JPEG o WebP válida.");
  }
  if (hinted && sniffed && hinted !== sniffed) {
    throw new ImageValidationError("El tipo declarado de la imagen no coincide con su contenido.");
  }

  const dims = imageDimensions(buffer, mime);
  if (!dims) {
    if (options.requireDimensions !== false) {
      throw new ImageValidationError("No se pudieron leer las dimensiones de la imagen.");
    }
    throw new ImageValidationError("La imagen no tiene dimensiones válidas.");
  }
  if (dims.width < 16 || dims.height < 16) {
    throw new ImageValidationError("La imagen es demasiado pequeña.");
  }
  if (dims.width > options.maxDimension || dims.height > options.maxDimension) {
    throw new ImageValidationError(
      `La imagen supera el tamaño máximo de ${options.maxDimension}px por lado.`,
    );
  }

  return {
    buffer,
    mime,
    extension: EXTENSION_BY_MIME[mime],
    width: dims.width,
    height: dims.height,
    bytes: buffer.length,
    checksumSha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

export function mimeForExtension(extension: string): string {
  return MIME_BY_EXTENSION[extension.toLowerCase()] || "application/octet-stream";
}

/**
 * Ajusta un tamaño al presupuesto de píxeles conservando la relación de
 * aspecto. FLUX.2 Klein se comporta bien alrededor de 1 MP.
 */
export function fitToPixelBudget(
  width: number,
  height: number,
  maxPixels: number,
): { width: number; height: number } {
  const safeWidth = Math.max(16, Math.round(width || 1024));
  const safeHeight = Math.max(16, Math.round(height || 1024));
  const pixels = safeWidth * safeHeight;
  if (pixels <= maxPixels) return { width: safeWidth, height: safeHeight };
  const scale = Math.sqrt(maxPixels / pixels);
  // FLUX trabaja mejor con múltiplos de 16. Se redondea hacia abajo y, si el
  // redondeo dejara el área por encima del presupuesto, se recorta el lado
  // mayor. Así `width * height <= maxPixels` siempre se cumple.
  let fittedWidth = Math.max(16, Math.floor((safeWidth * scale) / 16) * 16);
  let fittedHeight = Math.max(16, Math.floor((safeHeight * scale) / 16) * 16);
  while (fittedWidth * fittedHeight > maxPixels) {
    if (fittedWidth >= fittedHeight && fittedWidth > 16) {
      fittedWidth -= 16;
    } else if (fittedHeight > 16) {
      fittedHeight -= 16;
    } else {
      break;
    }
  }
  return { width: fittedWidth, height: fittedHeight };
}

function safeSegment(value: string): string {
  return String(value || "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}

export function imageStoragePrefix(userId: string, chatId: string): string {
  return `images/${safeSegment(userId)}/${safeSegment(chatId)}`;
}

export function referenceObjectKey(
  userId: string,
  chatId: string,
  jobId: string,
  index: number,
  extension: string,
): string {
  return `${imageStoragePrefix(userId, chatId)}/refs/${safeSegment(jobId)}/${index}.${safeSegment(extension)}`;
}

export function generatedImageObjectKey(
  userId: string,
  chatId: string,
  imageId: string,
  extension: string,
): string {
  return `${imageStoragePrefix(userId, chatId)}/${safeSegment(imageId)}.${safeSegment(extension)}`;
}

export function imageDownloadUrl(id: string): string {
  return `/api/images/${encodeURIComponent(id)}?download=1`;
}

export function imagePreviewUrl(id: string): string {
  return `/api/images/${encodeURIComponent(id)}`;
}

export function imageFilename(prefix: string, id: string, extension: string): string {
  const safePrefix = String(prefix || "imagen").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `${safePrefix}-${String(id).slice(0, 8)}.${extension}`;
}
