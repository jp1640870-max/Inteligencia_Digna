/**
 * IP del solicitante, para las entradas de `audit_log`.
 *
 * Detrás de un proxy o balanceador `x-forwarded-for` llega como lista y el
 * primer elemento es el cliente original. Se usa `??` en lugar de `||` porque
 * `headers.get` devuelve `null` (no cadena vacía) cuando la cabecera no existe.
 *
 * Solo es fiable si el proxy inserta la cabecera. Si el despliegue acepta
 * conexiones directas a la app, alguien podría falsificarla. Para una postura
 * de confianza estricta hay que terminar el tráfico en el proxy y rechazar el
 * acceso directo al puerto de la aplicación.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "";
  return req.headers.get("x-real-ip") ?? "";
}
