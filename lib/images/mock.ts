import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

import { getImageConfig } from "./config";
import {
  ComfyCancelledError,
  type ComfyGenerateHooks,
  type ComfyGenerateInput,
  type ComfyHealth,
  type ComfyImageRef,
  type ComfyInspection,
  type ComfyOutput,
  type ImageBackend,
} from "./comfyui";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const value of buffer) crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** PNG sólido y válido para pruebas sin GPU. */
export function createMockPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 3] = rgb[0];
    row[2 + x * 3] = rgb[1];
    row[3 + x * 3] = rgb[2];
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export class MockImageBackend implements ImageBackend {
  readonly name = "mock-flux2-klein";

  async generate(
    input: ComfyGenerateInput,
    hooks: ComfyGenerateHooks,
  ): Promise<ComfyOutput> {
    const promptId = `mock-${input.jobId}`;
    await hooks.onPromptId(promptId);
    const cfg = getImageConfig();
    const delay = Math.max(0, cfg.mockDelayMs);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (await hooks.isCancelled?.()) throw new ComfyCancelledError();

    const hash = createHash("sha256").update(`${input.prompt}:${input.seed}`).digest();
    const rgb: [number, number, number] = [hash[0], hash[1], hash[2]];
    const width = Math.max(16, Math.min(1024, input.width));
    const height = Math.max(16, Math.min(1024, input.height));
    return {
      buffer: createMockPng(width, height, rgb),
      mimeType: "image/png",
      filename: `mock-${input.jobId}.png`,
      promptId,
    };
  }

  async cancel(_promptId: string): Promise<{ deleted: boolean; interrupted: boolean }> {
    void _promptId;
    return { deleted: true, interrupted: false };
  }

  async inspect(_promptId: string): Promise<ComfyInspection> {
    void _promptId;
    return { state: "not_found" };
  }

  async downloadOutput(
    _reference: ComfyImageRef,
    _promptId?: string,
  ): Promise<ComfyOutput> {
    void _reference;
    void _promptId;
    throw new Error("El backend simulado no conserva salidas para recuperación.");
  }

  async health(): Promise<ComfyHealth> {
    return {
      ok: true,
      url: "mock://comfyui",
      workflowConfigured: false,
      workflowReadable: false,
    };
  }
}

/** Backend pendiente de recuperación: simula un prompt_id perdido. */
export class LostPromptBackend extends MockImageBackend {
  override async inspect(_promptId: string): Promise<ComfyInspection> {
    void _promptId;
    return { state: "not_found" };
  }
}

export type MockImageRef = ComfyImageRef;
