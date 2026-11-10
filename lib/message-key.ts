import type { Msg } from "@/types";

/**
 * Key estable para la lista de mensajes del chat.
 *
 * Los mensajes persistidos traen `id` numérico (BIGINT de la BD) y los
 * optimistas solo `localId`. Usar `m.id ?? i` mezcla ambos espacios y, a
 * partir del mensaje 8, el índice fallback colisiona con el `id` 8.
 * Los prefijos mantienen cada identidad en su propio espacio.
 */
export function messageKey(m: Pick<Msg, "id" | "localId">, index: number): string {
  if (m.id != null) return `msg-${m.id}`;
  if (m.localId) return `local-${m.localId}`;
  return `tmp-${index}`;
}
