/**
 * Kernel de la Knowledge Base compartida.
 *
 * Reutiliza el pipeline RAG existente (chunking, embeddings vía Ollama,
 * similitud coseno) pero opera sobre archivos de KB (`kb_files`/`kb_chunks`)
 * en lugar de documentos de chat/proyecto (`rag_chunks`).
 */

import { v4 as uuidv4 } from "uuid";
import {
  getKbFileById,
  getKbCategoryById,
  getKbCategories,
  storeKbChunks,
  getKbChunksByCategoryIds,
  deleteKbChunksByFile,
  deleteKbFileById,
  updateKbFile,
  countKbChunksByFile,
  findKbFileByName,
} from "@/lib/db";
import {
  chunkDocument,
  generateEmbedding,
  cosineSimilarity,
} from "@/lib/rag";
import type { KbSource } from "@/types";

const SIMILARITY_THRESHOLD = 0.5;
const TOP_K = 5;
/** Tope de chunks por archivo: salvaguarda contra documentos monstruosos. */
const MAX_CHUNKS_PER_FILE = 2000;
/** Concurrencia de embeddings (evita saturar Ollama al indexar archivos grandes). */
const EMBEDDING_CONCURRENCY = 4;

type IndexResult = {
  chunks: number;
  truncated: boolean;
  tookMs: number;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Indexa (o reindexa) un archivo: divide en chunks, genera embeddings y
 * los persiste en `kb_chunks`. Idempotente: borra los chunks previos primero.
 *
 * NO modifica el `status` del archivo — el caller decide (active/hold).
 */
export async function indexKbFile(fileId: string): Promise<IndexResult> {
  const started = Date.now();
  const file = getKbFileById(fileId);
  if (!file) throw new Error(`Archivo KB ${fileId} no encontrado`);

  deleteKbChunksByFile(fileId);

  const rawChunks = chunkDocument(file.content || "");
  const chunks = rawChunks.slice(0, MAX_CHUNKS_PER_FILE);
  const truncated = rawChunks.length > MAX_CHUNKS_PER_FILE;

  if (chunks.length === 0) {
    return { chunks: 0, truncated, tookMs: Date.now() - started };
  }

  const embeddings = await mapWithConcurrency(
    chunks,
    EMBEDDING_CONCURRENCY,
    (chunk) => generateEmbedding(chunk)
  );

  const valid = chunks
    .map((content, i) => ({ content, embedding: embeddings[i] }))
    .filter((e) => e.embedding.length > 0);

  storeKbChunks(
    valid.map((e, i) => ({
      id: uuidv4(),
      file_id: fileId,
      category_id: file.category_id ?? null,
      chunk_index: i,
      content: e.content,
      embedding: JSON.stringify(e.embedding),
    }))
  );

  return { chunks: valid.length, truncated, tookMs: Date.now() - started };
}

/**
 * Recupera los chunks KB más relevantes para una consulta, restringidos a las
 * categorías autorizadas (hoy: todas las vistas → ['general'] cuando existan
 * los permisos por área, aquí llega el filtro).
 */
export async function retrieveKb(
  query: string,
  categoryIds?: string[]
): Promise<Array<KbSource & { content: string }>> {
  if (!query?.trim() || !categoryIds || categoryIds.length === 0) return [];

  const queryEmbedding = await generateEmbedding(query);
  if (queryEmbedding.length === 0) return [];

  const chunks = getKbChunksByCategoryIds(categoryIds);
  if (chunks.length === 0) return [];

  const categoryCache = new Map<string, { name: string; label: string } | null>();
  const categoryName = (id: string | null): string | null => {
    if (!id) return null;
    if (!categoryCache.has(id)) {
      const cat = getKbCategoryById(id);
      categoryCache.set(id, cat ? { name: cat.name, label: cat.label } : null);
    }
    return categoryCache.get(id)?.name ?? null;
  };

  const scored = chunks
    .map((chunk) => {
      let chunkEmbedding: number[];
      try {
        chunkEmbedding = JSON.parse(chunk.embedding);
      } catch {
        return null;
      }
      if (!chunkEmbedding || chunkEmbedding.length === 0) return null;
      const score = cosineSimilarity(queryEmbedding, chunkEmbedding);
      if (score <= SIMILARITY_THRESHOLD) return null;
      return {
        file_id: chunk.file_id,
        filename: chunk.filename || "documento",
        category: categoryName(chunk.category_id),
        chunk_index: chunk.chunk_index,
        score,
        content: chunk.content,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);

  if (scored.length === 0) return scored;

  // ── Ventana de contexto ±1 chunk ──
  // Cada acierto puede caer a mitad de una frase/tabla (chunks de ~500 chars).
  // Agregamos el chunk anterior y posterior del MISMO archivo para que la
  // respuesta no llegue cortada al modelo.
  const byFile = new Map<string, typeof chunks>();
  for (const c of chunks) {
    if (!byFile.has(c.file_id)) byFile.set(c.file_id, []);
    byFile.get(c.file_id)!.push(c);
  }

  const seenIndexes = new Set<string>();
  const expanded: Array<{ file_id: string; filename: string; category: string | null; chunk_index: number; score: number; content: string }> = [];

  for (const hit of scored) {
    const fileChunks = byFile.get(hit.file_id) || [];
    // centro + vecinos ±1, preservando su orden dentro del archivo
    for (const n of [hit.chunk_index - 1, hit.chunk_index, hit.chunk_index + 1]) {
      const neighbor = fileChunks.find((c) => c.chunk_index === n);
      if (!neighbor) continue;
      const key = `${neighbor.file_id}:${neighbor.chunk_index}`;
      if (seenIndexes.has(key)) continue;
      seenIndexes.add(key);
      expanded.push({
        file_id: neighbor.file_id,
        filename: neighbor.filename || "documento",
        category: categoryName(neighbor.category_id),
        chunk_index: neighbor.chunk_index,
        score: n === hit.chunk_index ? hit.score : hit.score, // herencia de relevancia del centro
        content: neighbor.content,
      });
    }
  }

  // Orden: primero los aciertos (mayor score), luego su contexto — por score desc
  expanded.sort((a, b) => b.score - a.score);
  return expanded;
}

/** Borra archivo + sus chunks (limpiando conflictos apuntados a él). */
export function deleteKbFile(fileId: string): boolean {
  deleteKbChunksByFile(fileId);
  return deleteKbFileById(fileId);
}

/** Verifica si el status del archivo está limpio para consulta. */
export function isKbFileActive(fileId: string): boolean {
  const file = getKbFileById(fileId);
  return !!file && file.status === "active";
}

/**
 * Resolución "mantener ambos": el archivo nuevo pasa a activo con nombre
 * "original (2).ext" y se reindexa bajo su nuevo nombre (en realidad solo se
 * actualiza metadata — el RAG no depende del nombre).
 */
export function resolveKeepBoth(fileId: string): { filename: string } | null {
  const file = getKbFileById(fileId);
  if (!file || file.status !== "hold") return null;

  // Generar "nombre (2).ext"
  const dot = file.filename.lastIndexOf(".");
  const base = dot > 0 ? file.filename.slice(0, dot) : file.filename;
  const ext = dot > 0 ? file.filename.slice(dot) : "";

  let candidate = `${base} (2)${ext}`;
  let n = 2;
  const existing = findKbFileByName(candidate);
  while (existing.length > 0) {
    n++;
    candidate = `${base} (${n})${ext}`;
  }

  updateKbFile(fileId, {
    filename: candidate,
    status: "active",
    conflict_with: null,
  });

  return { filename: candidate };
}

/** Valida el nombre de archivo normalizado para evitar duplicados accidentales. */
export function normalizeFileName(name: string): string {
  return name.trim().normalize("NFC");
}

/**
 * Convierte fragmentos recuperados en fuentes (sin contenido) para trazabilidad
 * admin (messages.kb_sources), evitando exceso de datos en la ruta de chat.
 */
export function toKbSources(
  hits: Array<{ content: string; category: string | null; score: number; file_id: string; filename: string; chunk_index: number }>
): KbSource[] {
  return hits.map((h) => ({
    file_id: h.file_id,
    filename: h.filename,
    category: h.category || "general",
    chunk_index: h.chunk_index,
    score: h.score,
  }));
}

/**
 * IDs de categorías visibles para un usuario.
 *
 * HOY: todos los usuarios autenticados consultan toda la KB (categorías
 * con contenido activo).
 * FUTURO (perfiles por área/departamento): filtrar aquí según los grupos del
 * usuario — p.ej. RH solo ve 'recursos_humanos' + 'general'.
 */
export function getKbScopeIdsForUser(): string[] {
  return getKbCategories()
    .filter((c) => c.active_count > 0)
    .map((c) => c.id);
}

/**
 * Formatea los chunks recuperados como contexto para el prompt.
 * NO incluye nombres de archivo (la respuesta al usuario no debe citarlos);
 * solo el área y el contenido.
 */
export function formatKbContext(
  hits: Array<{ content: string; category: string | null; score: number }>
): string {
  if (hits.length === 0) return "";
  return hits
    .map(
      (h) =>
        `[Área: ${h.category || "general"} | Relevancia: ${(h.score * 100).toFixed(0)}%]\n${h.content}`,
    )
    .join("\n\n---\n\n");
}

export { countKbChunksByFile };