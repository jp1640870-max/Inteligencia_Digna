/**
 * Verifica que LibreOffice esté disponible y que la conversión DOCX → PDF funcione.
 *
 * Uso: npm run doc:check
 */
import { Document, Packer, Paragraph } from "docx";
import { readEffectiveEnv } from "./lib/env-file";
import { convertDocxToPdf, resolveLibreOfficeBinary } from "../lib/docx-to-pdf";

const ENV_KEYS = [
  "LIBREOFFICE_BIN",
  "DOC_PDF_ENGINE",
  "DOC_CONVERSION_TIMEOUT_MS",
  "DOC_CONVERSION_CONCURRENCY",
] as const;

async function main(): Promise<void> {
  const effective = readEffectiveEnv();
  for (const key of ENV_KEYS) {
    const value = effective[key]?.trim();
    if (value) process.env[key] = value;
  }

  const binary = resolveLibreOfficeBinary();
  if (!binary) {
    console.error("❌ LibreOffice no encontrado.");
    console.error("   Instálalo o define LIBREOFFICE_BIN en .env.");
    console.error('   Windows: C:\\Program Files\\LibreOffice\\program\\soffice.exe');
    process.exit(1);
  }

  const doc = new Document({
    creator: "Inteligencia Digna",
    sections: [
      {
        children: [
          new Paragraph({ text: "Prueba de conversión DOCX → PDF" }),
          new Paragraph("Acentos: áéíóú ñ. Símbolos: ≤ ≥."),
        ],
      },
    ],
  });

  const docx = Buffer.from(await Packer.toBuffer(doc));
  const started = Date.now();

  try {
    const pdf = await convertDocxToPdf(docx);
    if (pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("el resultado no empieza con %PDF-");
    }
    console.log(`✅ LibreOffice OK: ${binary}`);
    console.log(`   PDF de prueba: ${pdf.length} bytes en ${Date.now() - started} ms`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Falló la conversión: ${message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`❌ Error inesperado: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
