import { storeChunk, getChunksByChat, deleteChunksByDocument } from "@/lib/db";
import { env } from "@/lib/env";

const OLLAMA_URL = env.OLLAMA_URL;
const EMBEDDING_MODEL = "nomic-embed-text";
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;
const TOP_K = 3;
const SIMILARITY_THRESHOLD = 0.5;

type EmbeddingResponse = {
  embedding: number[];
};

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

    // Try to break at a sentence or paragraph boundary
    const searchArea = text.slice(Math.max(0, end - 100), end + 100);
    const sentenceBreak = searchArea.search(/[.!?\n]\s/);
    if (sentenceBreak !== -1 && sentenceBreak < 150) {
      end = Math.max(0, end - 100) + sentenceBreak + 1;
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
  }

  return chunks.filter((c) => c.length > 20);
}

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: text,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.log(`🧠 Embedding error: ${res.status}`);
      return [];
    }

    const data: EmbeddingResponse = await res.json();
    return data.embedding || [];
  } catch (e) {
    console.log(`🧠 Embedding error: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
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

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

export async function retrieveRelevantChunks(
  chatId: string,
  query: string,
  k = TOP_K,
): Promise<{ content: string; score: number; documentName: string }[]> {
  const queryEmbedding = await generateEmbedding(query);
  if (queryEmbedding.length === 0) return [];

  const chunks = getChunksByChat(chatId);
  if (chunks.length === 0) return [];

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
      return { content: chunk.content, score, documentName: chunk.document_name };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null && c.score > SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return scored;
}

export async function indexDocument(
  chatId: string,
  userId: string,
  documentName: string,
  text: string,
  projectId?: string,
): Promise<void> {
  deleteChunksByDocument(chatId, documentName);

  const chunks = chunkDocument(text);
  console.log(`🧠 Indexando "${documentName}": ${chunks.length} chunks`);

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await generateEmbedding(chunks[i]);
    if (embedding.length === 0) {
      console.log(`🧠 Chunk ${i}: embedding vacío, omitiendo`);
      continue;
    }

    storeChunk({
      id: crypto.randomUUID(),
      user_id: userId,
      chat_id: chatId,
      project_id: projectId || null,
      document_name: documentName,
      chunk_index: i,
      content: chunks[i],
      embedding: JSON.stringify(embedding),
    });
  }

  console.log(`🧠 Indexación completa: ${chunks.length} chunks para "${documentName}"`);
}

export function formatRagContext(
  chunks: { content: string; score: number; documentName: string }[],
): string {
  if (chunks.length === 0) return "";

  return chunks
    .map(
      (c, i) =>
        `[Documento: ${c.documentName} | Relevancia: ${(c.score * 100).toFixed(0)}%]\n${c.content}`,
    )
    .join("\n\n---\n\n");
}
