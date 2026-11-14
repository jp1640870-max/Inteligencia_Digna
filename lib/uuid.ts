/**
 * Valida que una cadena sea un UUID v4/v5 bien formado.
 *
 * Se usa antes de consultar PostgreSQL para evitar enviar valores no UUID a una
 * columna uuid, lo que provocaría un error 22P02 (invalid input syntax) y un
 * 500 al cliente. Un id inválido simplemente no existe: devuelve 404.
 */
export function isValidUuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
