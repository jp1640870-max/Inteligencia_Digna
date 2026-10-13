import {
  canAccessKbFileFromPanel,
  getKbChunksByFileIds,
  getKbFiles,
  listKbFilesVisibleToPanel,
  searchKbChunks,
  searchKbChunksByAccess,
} from "@/lib/db";
import type { KbChunk, KbFile, UserRole } from "@/types";

/**
 * Resolución de acceso a la Knowledge Base.
 *
 * Este módulo es la única puerta de entrada. Las rutas de API, el retrieval y el
 * frontend no deciden acceso por su cuenta: preguntan aquí.
 *
 * Reglas:
 *  - Sin grant explícito no hay acceso. La ausencia de política es denegación,
 *    nunca permiso implícito.
 *  - `super_admin` y `admin` tienen bypass: son el perímetro y gestionan el
 *    contenido en lugar de consultarlo. El control sobre ellos es detective
 *    (auditoría + revisión periódica de grants), no preventivo.
 *  - La categoría NO concede acceso. Clasifica para el dashboard y da el
 *    vocabulario de las acciones en lote; el permiso cuelga del archivo.
 *  - Solo `status = 'active'` es buscable. `pending_review` y `hold` quedan
 *    fuera del retrieval aunque el usuario tenga grant.
 *  - `editor` ve además lo que él mismo subió, para poder preparar el
 *    contenido. Ver la nota de {@link visibleKbFiles}.
 *
 * Sin caché a propósito: una decisión cacheada retrasaría una revocación, que
 * es justo lo que quien revoca espera que ocurra de inmediato.
 */

export function isPerimeterRole(role: unknown): role is "super_admin" | "admin" {
  return role === "super_admin" || role === "admin";
}

/**
 * Archivos visibles en el panel de administración.
 *
 * `super_admin` y `admin` reciben la lista completa porque su bypass se aplica
 * en el SQL, igual que en el resto de rutas. Así una ruta que solo use esta
 * función no se convierte en un agujero por olvidar el bypass.
 *
 * Para `editor` el alcance es "lo que tiene por grant **o lo que él subió**", y
 * el motivo de esa segunda mitad es concreto: un `editor` sube documentos para
 * que el texto se extraiga y se revise, y no puede cumplir esa función si el
 * panel le oculta lo que acaba de subir. Ver {@link listKbFilesVisibleToPanel}
 * en `lib/db.ts` para el detalle de por qué esto no relaja nada más.
 *
 * Ojo al alcance real de esta diferencia: sin ella el `editor` no podría ver
 * un archivo sin grant, pero tampoco podría ver los suyos, que es como estaba.
 */
export async function visibleKbFiles(
  user: { id: string; role: UserRole | string },
  options: { categoryId?: string; status?: string; search?: string } = {},
): Promise<KbFile[]> {
  if (isPerimeterRole(user.role)) return getKbFiles(options);
  return listKbFilesVisibleToPanel(user.id, options);
}

/**
 * Si puede leer el contenido de este archivo concreto.
 *
 * El bypass del perímetro se resuelve antes de tocar la base de datos; para el
 * resto, una sola consulta que decide por autoría o por grant.
 *
 * Es la condición que debe acompañar a cualquier lectura de contenido: la
 * capability `kb.read` de la matriz de roles dice si la ruta se atiende, esta
 * función dice de qué archivo se trata.
 */
export async function userCanReadKbFile(
  user: { id: string; role: UserRole | string },
  fileId: string,
): Promise<boolean> {
  if (isPerimeterRole(user.role)) return true;
  return canAccessKbFileFromPanel(user.id, fileId);
}

export type KbScoredChunk = KbChunk & { filename: string; score: number };

/** Recuperación de fragmentos para el RAG, sujeta al ACL del usuario. */
export async function retrieveAccessibleChunks(
  user: { id: string; role: UserRole | string },
  queryEmbedding: number[] | string,
  threshold: number,
  limit: number,
): Promise<KbScoredChunk[]> {
  if (isPerimeterRole(user.role)) return searchKbChunks(queryEmbedding, threshold, limit);
  return searchKbChunksByAccess(user.id, queryEmbedding, threshold, limit);
}

export type KbExpandedHit = {
  file_id: string;
  filename: string;
  category: string | null;
  chunk_index: number;
  score: number;
  content: string;
};

/**
 * Expansión de vecinos: se añade el chunk anterior y el siguiente a cada hit.
 *
 * Antes se cargaban TODOS los chunks con su embedding (1024 floats por fila)
 * solo para descartar el vector y quedarse con el texto. Ahora es una consulta
 * agrupada por los archivos que tocaron al hit, y sin la columna `embedding`.
 */
export async function expandNeighborChunks(
  hits: Array<{ file_id: string; chunk_index: number; score: number }>,
): Promise<KbExpandedHit[]> {
  if (hits.length === 0) return [];

  const chunks = await getKbChunksByFileIds([...new Set(hits.map((hit) => hit.file_id))]);
  const byFile = new Map<string, typeof chunks>();
  for (const chunk of chunks) {
    const list = byFile.get(chunk.file_id);
    if (list) list.push(chunk);
    else byFile.set(chunk.file_id, [chunk]);
  }

  const seen = new Set<string>();
  const expanded: KbExpandedHit[] = [];
  for (const hit of hits) {
    const fileChunks = byFile.get(hit.file_id) ?? [];
    for (const index of [hit.chunk_index - 1, hit.chunk_index, hit.chunk_index + 1]) {
      const neighbor = fileChunks.find((chunk) => chunk.chunk_index === index);
      if (!neighbor) continue;
      const key = `${neighbor.file_id}:${neighbor.chunk_index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      expanded.push({
        file_id: neighbor.file_id,
        filename: neighbor.filename,
        category: neighbor.category_name,
        chunk_index: neighbor.chunk_index,
        score: hit.score,
        content: neighbor.content,
      });
    }
  }
  expanded.sort((a, b) => b.score - a.score);
  return expanded;
}
