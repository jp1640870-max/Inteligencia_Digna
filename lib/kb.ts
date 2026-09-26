import { v4 as uuidv4 } from "uuid";
import {
  getKbFileById,
  getKbCategoryById,
  getKbCategories,
  storeKbChunks,
  getKbChunksByCategoryIds,
  searchKbChunksByCategories,
  deleteKbChunksByFile,
  deleteKbFileById,
  updateKbFile,
  countKbChunksByFile,
  findKbFileByName,
} from "@/lib/db";
import { chunkDocument, generateEmbedding, generateEmbeddings } from "@/lib/rag";
import type { KbCategory, KbSource } from "@/types";

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

export async function retrieveKb(query: string, categoryIds?: string[]): Promise<KbHit[]> {
  if (!query.trim() || !categoryIds || categoryIds.length === 0) return [];
  const chunks = await getKbChunksByCategoryIds(categoryIds);
  if (chunks.length === 0) return [];
  const queryEmbedding = await generateEmbedding(query);
  if (queryEmbedding.length === 0) return [];

  const categoryCache = new Map<string, Promise<KbCategory | null>>();
  const getCategory = (id: string | null): Promise<KbCategory | null> => {
    if (!id) return Promise.resolve(null);
    let value = categoryCache.get(id);
    if (!value) {
      value = getKbCategoryById(id);
      categoryCache.set(id, value);
    }
    return value;
  };

  const scored = await searchKbChunksByCategories(categoryIds, queryEmbedding, SIMILARITY_THRESHOLD, TOP_K);
  if (scored.length === 0) return [];

  const byFile = new Map<string, typeof chunks>();
  for (const chunk of chunks) {
    const list = byFile.get(chunk.file_id) || [];
    list.push(chunk);
    byFile.set(chunk.file_id, list);
  }
  const seen = new Set<string>();
  const expanded: KbHit[] = [];
  for (const hit of scored) {
    const fileChunks = byFile.get(hit.file_id) || [];
    for (const index of [hit.chunk_index - 1, hit.chunk_index, hit.chunk_index + 1]) {
      const neighbor = fileChunks.find((chunk) => chunk.chunk_index === index);
      if (!neighbor) continue;
      const key = `${neighbor.file_id}:${neighbor.chunk_index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const category = await getCategory(neighbor.category_id);
      expanded.push({
        file_id: neighbor.file_id,
        filename: neighbor.filename || "documento",
        category: category?.name || null,
        chunk_index: neighbor.chunk_index,
        score: hit.score,
        content: neighbor.content,
      });
    }
  }
  expanded.sort((a, b) => b.score - a.score);
  return expanded;
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

export async function getKbScopeIdsForUser(): Promise<string[]> {
  const categories = await getKbCategories();
  return categories.filter((category) => category.active_count > 0).map((category) => category.id);
}

export function formatKbContext(hits: Array<{ content: string; category: string | null; score: number }>): string {
  if (hits.length === 0) return "";
  return hits
    .map((hit) => `[Área: ${hit.category || "general"} | Relevancia: ${(hit.score * 100).toFixed(0)}%]\n${hit.content}`)
    .join("\n\n---\n\n");
}

export { countKbChunksByFile };
