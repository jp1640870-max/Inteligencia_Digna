import { v4 as uuidv4 } from "uuid";
import {
  getKbFileById,
  storeKbChunks,
  deleteKbChunksByFile,
  deleteKbFileById,
  updateKbFile,
  countKbChunksByFile,
  findKbFileByName,
} from "@/lib/db";
import { expandNeighborChunks, retrieveAccessibleChunks } from "@/lib/kb-access";
import { chunkDocument, generateEmbedding, generateEmbeddings } from "@/lib/rag";
import type { KbSource, UserRole } from "@/types";

const SIMILARITY_THRESHOLD = 0.5;
const TOP_K = 5;
const MAX_CHUNKS_PER_FILE = 2000;
const EMBEDDING_BATCH_SIZE = 32;

type IndexResult = {
  chunks: number;
  truncated: boolean;
  tookMs: number;
};

type KbHit = KbSource & { content: string };

async function embedInBatches(texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let index = 0; index < texts.length; index += EMBEDDING_BATCH_SIZE) {
    vectors.push(...(await generateEmbeddings(texts.slice(index, index + EMBEDDING_BATCH_SIZE))));
  }
  return vectors;
}

export async function indexKbFile(fileId: string): Promise<IndexResult> {
  const started = Date.now();
  const file = await getKbFileById(fileId);
  if (!file) throw new Error(`Archivo KB ${fileId} no encontrado`);

  const rawChunks = chunkDocument(file.content || "");
  const chunks = rawChunks.slice(0, MAX_CHUNKS_PER_FILE);
  const truncated = rawChunks.length > MAX_CHUNKS_PER_FILE;
  if (chunks.length === 0) return { chunks: 0, truncated, tookMs: Date.now() - started };

  const embeddings = await embedInBatches(chunks);
  const valid = chunks
    .map((content, index) => ({ content, embedding: embeddings[index] }))
    .filter((item) => item.embedding && item.embedding.length > 0);
  if (valid.length === 0) throw new Error("No se generaron embeddings válidos");

  await deleteKbChunksByFile(fileId);
  await storeKbChunks(
    valid.map((item, index) => ({
      id: uuidv4(),
      file_id: fileId,
      category_id: file.category_id ?? null,
      chunk_index: index,
      content: item.content,
      embedding: item.embedding,
    })),
  );
  return { chunks: valid.length, truncated, tookMs: Date.now() - started };
}

/**
 * Recuperación de la KB para un usuario concreto.
 *
 * El alcance ya no se deriva de las categorías: se resuelve contra el ACL del
 * usuario en `lib/kb-access.ts`. Las categorías se siguen usando para clasificar
 * y para el dashboard, pero no deciden quién lee qué.
 */
export async function retrieveKb(
  query: string,
  user: { id: string; role: UserRole | string },
): Promise<KbHit[]> {
  if (!query.trim()) return [];
  const queryEmbedding = await generateEmbedding(query);
  if (queryEmbedding.length === 0) return [];

  const scored = await retrieveAccessibleChunks(user, queryEmbedding, SIMILARITY_THRESHOLD, TOP_K);
  if (scored.length === 0) return [];

  const expanded = await expandNeighborChunks(scored);
  if (expanded.length === 0) return [];
  return expanded.map((hit) => ({
    file_id: hit.file_id,
    filename: hit.filename,
    category: hit.category,
    chunk_index: hit.chunk_index,
    score: hit.score,
    content: hit.content,
  }));
}

export async function deleteKbFile(fileId: string): Promise<boolean> {
  await deleteKbChunksByFile(fileId);
  return deleteKbFileById(fileId);
}

export async function isKbFileActive(fileId: string): Promise<boolean> {
  const file = await getKbFileById(fileId);
  return Boolean(file && file.status === "active");
}

export function nextAvailableName(base: string, ext: string, exists: (candidate: string) => boolean): string {
  let n = 2;
  let candidate = `${base} (${n})${ext}`;
  while (exists(candidate)) {
    n += 1;
    candidate = `${base} (${n})${ext}`;
  }
  return candidate;
}

export async function resolveKeepBoth(fileId: string): Promise<{ filename: string } | null> {
  const file = await getKbFileById(fileId);
  if (!file || file.status !== "hold") return null;
  const dot = file.filename.lastIndexOf(".");
  const base = dot > 0 ? file.filename.slice(0, dot) : file.filename;
  const ext = dot > 0 ? file.filename.slice(dot) : "";
  let suffix = 2;
  let candidate = `${base} (${suffix})${ext}`;
  while ((await findKbFileByName(candidate)).length > 0) {
    suffix += 1;
    candidate = `${base} (${suffix})${ext}`;
  }
  await updateKbFile(fileId, { filename: candidate, status: "active", conflict_with: null });
  return { filename: candidate };
}

export function normalizeFileName(name: string): string {
  return name.trim().normalize("NFC");
}

export function toKbSources(hits: Array<{ content: string; category: string | null; score: number; file_id: string; filename: string; chunk_index: number }>): KbSource[] {
  return hits.map((hit) => ({
    file_id: hit.file_id,
    filename: hit.filename,
    category: hit.category || "general",
    chunk_index: hit.chunk_index,
    score: hit.score,
  }));
}

export function formatKbContext(hits: Array<{ content: string; category: string | null; score: number; filename: string }>): string {
  if (hits.length === 0) return "";
  return hits
    .map(
      (hit) =>
        `[Documento: ${hit.filename} | Área: ${hit.category || "general"} | Relevancia: ${(hit.score * 100).toFixed(0)}%]\n${hit.content}`,
    )
    .join("\n\n---\n\n");
}

export { countKbChunksByFile };
