/**
 * Interruptor temporal del login con Google.
 *
 * Apagado por defecto: hay que definir GOOGLE_OAUTH_ENABLED=true de forma
 * explícita para que aparezca el botón y se atiendan las rutas OAuth. Un solo
 * flag gira la UI y la API, de modo que ocultar el botón no deje un acceso por
 * URL directa.
 */
export function isGoogleOAuthEnabled(
  value: string | undefined = process.env.GOOGLE_OAUTH_ENABLED,
): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}
