import type { SearchResult } from "@/types";

const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:4000";
const SEARCH_TIMEOUT = 10_000;
const MAX_RESULTS = 5;

const SEARCH_KEYWORDS = [
  "buscar", "búsqueda", "encuentra", "encuentre",
  "qué es", "quién es", "cómo se", "dónde está", "cuándo",
  "noticias", "últimas", "recientes", "actualidad",
  "precio", "cuánto cuesta", "cuánto vale",
  "investigar", "consulta", "información sobre",
  "precio de", "cotización de",
  "definición de", "significado de",
  "último", "nuevo", "novedades",
  "clima", "pronóstico", "temperatura",
  "traduce", "traducción",
  "resumen de", "síntesis de",
];

type SearXNGResult = {
  title?: string;
  url?: string;
  content?: string;
};

type SearXNGResponse = {
  results?: SearXNGResult[];
  answers?: string[];
  number_of_results?: number;
};

export function shouldAutoSearch(message: string): boolean {
  if (!message || message.trim().length === 0) return false;

  const lower = message.toLowerCase().trim();

  // Check if message is too short to need search
  if (lower.length < 10) return false;

  // Check for explicit search keywords
  return SEARCH_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export async function searchWeb(query: string): Promise<SearchResult[]> {
  if (!query || query.trim().length === 0) return [];

  const encoded = encodeURIComponent(query.trim());
  const url = `${SEARXNG_URL}/search?q=${encoded}&format=json`;

  try {
    console.log(`🌐 SearXNG fetch: "${query.slice(0, 60)}"`);

    const res = await fetch(url, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT),
      headers: { "Accept": "application/json" },
    });

    if (!res.ok) {
      console.log(`🌐 SearXNG error: ${res.status} ${res.statusText}`);
      return [];
    }

    const data: SearXNGResponse = await res.json();

    if (!data.results || data.results.length === 0) {
      console.log("🌐 Sin resultados de búsqueda");
      return [];
    }

    const results: SearchResult[] = data.results
      .filter((r) => r.title && r.url && r.content)
      .slice(0, MAX_RESULTS)
      .map((r) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: r.content || "",
      }));

    console.log(`🌐 ${results.length} resultados de SearXNG`);
    return results;
  } catch (e) {
    console.log(`🌐 SearXNG error: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

export function formatSearchResults(sources: SearchResult[]): string {
  if (!sources || sources.length === 0) return "";

  return sources
    .map(
      (s, i) =>
        `${i + 1}. ${s.title}\n   URL: ${s.url}\n   ${s.snippet}`,
    )
    .join("\n\n");
}
