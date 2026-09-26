import { storeChunk, hasChunksForChat, searchChunksByChat, deleteChunksByDocument } from "@/lib/db";
import { ollamaEmbedding, ollamaEmbeddings } from "@/lib/ollama";

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;
const TOP_K = 3;
const SIMILARITY_THRESHOLD = 0.5;

export function chunkDocument(text: string, maxSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  if (!text || text.length === 0) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxSize;
    if (end >= text.length) {
      chunks.push(text.slice(start).trim());
      break;
    }
    const searchArea = text.slice(Math.max(0, end - 100), end + 100);
    const sentenceBreak = searchArea.search(/[.!?\n]\s/);
    if (sentenceBreak !== -1 && sentenceBreak < 150) end = Math.max(0, end - 100) + sentenceBreak + 1;
    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
  }
  return chunks.filter((chunk) => chunk.length > 20);
}

export async function generateEmbedding(text: string): Promise<number[]> {
  return ollamaEmbedding(text);
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  return ollamaEmbeddings(texts);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

export async function retrieveRelevantChunks(
  chatId: string,
  query: string,
  k = TOP_K,
): Promise<{ content: string; score: number; documentName: string }[]> {
  if (!(await hasChunksForChat(chatId))) return [];
  const queryEmbedding = await generateEmbedding(query);
  if (queryEmbedding.length === 0) return [];
  return searchChunksByChat(chatId, queryEmbedding, SIMILARITY_THRESHOLD, k);
}

export async function indexDocument(
  chatId: string,
  userId: string,
  documentName: string,
  text: string,
  projectId?: string,
): Promise<void> {
  const chunks = chunkDocument(text);
  if (chunks.length === 0) return;
  const embeddings = await generateEmbeddings(chunks);
  await deleteChunksByDocument(chatId, documentName);
  for (let i = 0; i < chunks.length; i++) {
    if (!embeddings[i] || embeddings[i].length === 0) continue;
    await storeChunk({
      id: crypto.randomUUID(),
      user_id: userId,
      chat_id: chatId,
      project_id: projectId || null,
      document_name: documentName,
      chunk_index: i,
      content: chunks[i],
      embedding: embeddings[i],
    });
  }
}

export function formatRagContext(chunks: { content: string; score: number; documentName: string }[]): string {
  if (chunks.length === 0) return "";
  return chunks
    .map((chunk) => `[Documento: ${chunk.documentName} | Relevancia: ${(chunk.score * 100).toFixed(0)}%]\n${chunk.content}`)
    .join("\n\n---\n\n");
}
