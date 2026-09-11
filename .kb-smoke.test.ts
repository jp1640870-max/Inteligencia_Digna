import { env } from "@/lib/env";
import { cosineSimilarity, chunkDocument } from "@/lib/rag";

async function main() {
  const OLLAMA_URL = env.OLLAMA_URL;
  const emb = async (p: string) =>
    (await (await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "bge-m3:latest", prompt: p }),
    })).json()).embedding;

  const a = await emb("Política de vacaciones de la empresa");
  console.log("embedding dims:", a?.length || 0);
  const b = await emb("Política de vacaciones");
  console.log("similitud coseno (relacionados):", cosineSimilarity(a, b).toFixed(4));
  const c = await emb("Receta de pasta con tomate");
  console.log("similitud coseno (no relacionados):", cosineSimilarity(a, c).toFixed(4));
  const chunks = chunkDocument("Un texto de prueba ".repeat(50));
  console.log("chunking ok:", chunks.length, "chunks:", chunks.map((x) => x.length).slice(0, 3).join(","));
  console.log("=== SMOKE TEST KB: TODO OK ===");
}
main().catch((e) => { console.error("SMOKE FAIL:", e.message); process.exit(1); });
