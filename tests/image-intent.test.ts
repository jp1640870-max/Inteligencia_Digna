import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  detectImageIntent,
  inferImageDimensions,
} from "../lib/images/intent";

/**
 * La detección de intención es la puerta de entrada a la GPU. Un falso
 * positivo gasta recursos y rompe el flujo conversacional; un falso negativo
 * hace que el botón y el lenguaje natural se comporten distinto. Estos casos
 * cubren las frases acordadas con el equipo.
 */

process.env.IMAGE_INTENT_USE_OLLAMA = "false";

async function intent(
  text: string,
  context: Parameters<typeof detectImageIntent>[1] = {},
) {
  return detectImageIntent(text, context);
}

describe("intención de imagen", () => {
  it("reconoce una orden directa de dibujar", async () => {
    const result = await intent("dibuja un gato");
    assert.equal(result.action, "generate");
    assert.equal(result.source, "rules");
    assert.match(result.prompt, /gato/);
  });

  it("reconoce una necesidad indirecta de banner", async () => {
    const result = await intent("necesito un banner horizontal para mi tienda");
    assert.equal(result.action, "generate");
    assert.equal(result.width, 1344);
    assert.equal(result.height, 768);
    assert.equal(result.dimensionsExplicit, true);
  });

  it("distingue una petición concreta de una pregunta de capacidad", async () => {
    const concrete = await intent("¿Puedes crearme una imagen de un laboratorio?");
    assert.equal(concrete.action, "generate");

    const capability = await intent("¿Puedes generar imágenes?");
    assert.equal(capability.action, "none");

    const how = await intent("¿Cómo se generan las imágenes?");
    assert.equal(how.action, "none");
  });

  it("no genera ante una negación explícita", async () => {
    const result = await intent("no generes una imagen de un gato");
    assert.equal(result.action, "none");
  });

  it("no genera ante preguntas de medidas o formato", async () => {
    const result = await intent("¿Cuál es el tamaño de un banner horizontal?");
    assert.equal(result.action, "none");
  });

  it("analizar una imagen no es editarla", async () => {
    const result = await intent("analiza esta imagen", { referenceCount: 1 });
    assert.equal(result.action, "none");
  });

  it("una pregunta visual sobre el adjunto es análisis", async () => {
    const result = await intent("¿Qué se ve en esta imagen? Descríbela.", {
      referenceCount: 1,
    });
    assert.equal(result.action, "none");
    const identity = await intent("¿Qué es esto?", { referenceCount: 1 });
    assert.equal(identity.action, "none");
  });

  it("detecta una edición contextual sobre la imagen anterior", async () => {
    const result = await intent("hazla más grande y cambia el fondo", {
      hasGeneratedParent: true,
    });
    assert.equal(result.action, "edit");
    assert.equal(result.useLatestImage, true);
  });

  it("detecta una variante contextual", async () => {
    const result = await intent("haz otra variante", {
      hasGeneratedParent: true,
    });
    assert.equal(result.action, "variant");
    assert.equal(result.useLatestImage, true);
  });

  it("no arrastra la imagen anterior a una generación nueva", async () => {
    const result = await intent("dibuja un perro", {
      hasGeneratedParent: true,
    });
    assert.equal(result.action, "generate");
    assert.equal(result.useLatestImage, false);
  });

  it("usa la imagen seleccionada aunque el texto sea una generación", async () => {
    const result = await intent("haz una imagen con este estilo", {
      hasGeneratedParent: true,
      parentImageId: "00000000-0000-0000-0000-000000000001",
    });
    assert.equal(result.action, "generate");
    assert.equal(result.parentImageId, "00000000-0000-0000-0000-000000000001");
  });

  it("el modo imagen fuerza aunque el texto sea ambiguo", async () => {
    const result = await intent("algo bonito", { forceImage: true });
    assert.equal(result.action, "generate");
    assert.equal(result.source, "forced");
    assert.ok(result.prompt.length > 0);
  });

  it("el modo imagen respeta la variante sobre la imagen seleccionada", async () => {
    const result = await intent("Crea una variación de esta imagen.", {
      forceImage: true,
      hasGeneratedParent: true,
      parentImageId: "00000000-0000-0000-0000-000000000001",
    });
    assert.equal(result.action, "variant");
    assert.equal(result.parentImageId, "00000000-0000-0000-0000-000000000001");
    assert.equal(result.useLatestImage, false);
  });

  it("el modo imagen respeta la edición sobre la imagen seleccionada", async () => {
    const result = await intent("Edita esta imagen: cambia el fondo a azul", {
      forceImage: true,
      hasGeneratedParent: true,
      parentImageId: "00000000-0000-0000-0000-000000000001",
    });
    assert.equal(result.action, "edit");
    assert.equal(result.parentImageId, "00000000-0000-0000-0000-000000000001");
  });

  it("pide aclaración para una petición visual sin tema", async () => {
    const result = await intent("haz algo visual");
    assert.equal(result.action, "clarify");
  });

  it("interpreta medidas explícitas y relaciones de aspecto", () => {
    assert.deepEqual(inferImageDimensions("800x600", { width: 1024, height: 1024 }), {
      width: 800,
      height: 600,
    });
    assert.deepEqual(inferImageDimensions("formato 9:16", { width: 1024, height: 1024 }), {
      width: 768,
      height: 1344,
    });
    assert.deepEqual(inferImageDimensions("un logo", { width: 1024, height: 768 }), {
      width: 1024,
      height: 1024,
    });
  });
});
