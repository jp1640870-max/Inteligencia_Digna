import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  requireCapability,
} from "@/lib/auth";
import { getKnowledgeEntries, createKnowledgeEntry, logAudit } from "@/lib/db";

/**
 * Tabla legacy `knowledge_entries`.
 *
 * Ya no participa en el retrieval (el chat lee `kb_files` + `kb_chunks`) ni
 * tiene grants: son entradas huérfanas del modelo anterior. Se conserva solo
 * para no perder lo ya escrito.
 *
 * Por eso la lectura devuelve el contenido completo y queda restringida al
 * perímetro, además de auditarse. Con el modelo por archivo, permitir que un
 * `editor` listara el texto íntegro saltaría el control de acceso sin dejar
 * rastro.
 */
export async function GET(req: Request) {
  const { allowed, status, user } = await requireCapability("kb.read.all");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category") || undefined;

  const entries = await getKnowledgeEntries(category);
  await logAudit(
    user.id,
    "knowledge.read_legacy",
    `Lectura de entradas legacy${category ? ` (categoría: ${category})` : ""}: ${entries.length} entrada(s) con contenido completo.`,
    "",
  );

  return NextResponse.json({ entries });
}

export async function POST(req: Request) {
  const { allowed, status, user } = await requireCapability("kb.upload");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { title, content, category } = await req.json();

  if (!title || !content) {
    return NextResponse.json({ error: "Título y contenido son requeridos" }, { status: 400 });
  }

  const id = uuidv4();
  await createKnowledgeEntry(id, title, content, category || "general", user.id);
  await logAudit(user.id, "knowledge.create", `Entrada creada: "${title}"`, "");

  return NextResponse.json({ success: true, id });
}
