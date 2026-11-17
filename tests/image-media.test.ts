import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  decodeImageInput,
  fitToPixelBudget,
  generatedImageObjectKey,
  imageDimensions,
  ImageValidationError,
  referenceObjectKey,
} from "../lib/images/media";
import { createMockPng } from "../lib/images/mock";

describe("medios de imagen", () => {
  it("valida un PNG real y extrae dimensiones", () => {
    const png = createMockPng(32, 48, [10, 20, 30]);
    const decoded = decodeImageInput(
      { data: png.toString("base64"), mime: "image/png" },
      { maxBytes: 1_000_000, maxDimension: 100 },
    );
    assert.equal(decoded.width, 32);
    assert.equal(decoded.height, 48);
    assert.equal(decoded.mime, "image/png");
    assert.equal(decoded.extension, "png");
    assert.match(decoded.checksumSha256, /^[a-f0-9]{64}$/);
  });

  it("rechaza un MIME declarado que no coincide con el contenido", () => {
    const png = createMockPng(20, 20, [1, 2, 3]);
    assert.throws(
      () =>
        decodeImageInput(
          { data: png.toString("base64"), mime: "image/jpeg" },
          { maxBytes: 1_000_000, maxDimension: 100 },
        ),
      ImageValidationError,
    );
  });

  it("rechaza contenido arbitrario", () => {
    assert.throws(
      () =>
        decodeImageInput(
          { data: Buffer.from("no soy una imagen").toString("base64") },
          { maxBytes: 1_000_000, maxDimension: 100 },
        ),
      ImageValidationError,
    );
  });

  it("respeta el presupuesto de píxeles y los múltiplos de 16", () => {
    for (const [width, height] of [
      [2000, 2000],
      [4032, 3024],
      [768, 4096],
      [1344, 768],
    ]) {
      const fitted = fitToPixelBudget(width, height, 1_100_000);
      assert.ok(fitted.width * fitted.height <= 1_100_000, `${width}x${height}`);
      assert.equal(fitted.width % 16, 0);
      assert.equal(fitted.height % 16, 0);
      assert.ok(fitted.width >= 16 && fitted.height >= 16);
    }
  });

  it("no amplía una imagen que ya cabe", () => {
    assert.deepEqual(fitToPixelBudget(1024, 1024, 1_100_000), {
      width: 1024,
      height: 1024,
    });
  });

  it("genera claves separadas por usuario y chat", () => {
    assert.equal(
      referenceObjectKey("user-1", "chat-1", "job-1", 0, "png"),
      "images/user-1/chat-1/refs/job-1/0.png",
    );
    assert.equal(
      generatedImageObjectKey("user-1", "chat-1", "image-1", "webp"),
      "images/user-1/chat-1/image-1.webp",
    );
  });

  it("lee dimensiones directamente del buffer", () => {
    assert.deepEqual(imageDimensions(createMockPng(64, 32, [0, 0, 0]), "image/png"), {
      width: 64,
      height: 32,
    });
  });
});
