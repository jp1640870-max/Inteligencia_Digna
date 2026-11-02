/**
 * Resuelve el origen público de una petición.
 *
 * En producción se confía únicamente en `NEXTAUTH_URL`: los headers
 * `x-forwarded-*` los puede enviar cualquiera si la app queda expuesta sin un
 * proxy de confianza, y usarlos para construir un redirect sería un open
 * redirect.
 *
 * En desarrollo se aceptan los hosts locales, la LAN y los túneles de ngrok.
 * Eso permite usar Google OAuth tanto en `https://localhost:3000` como en
 * `https://<algo>.ngrok-free.dev` sin cambiar `.env` entre uno y otro.
 */

const DEV_HOST_PATTERNS = [
  /^localhost(:\d+)?$/i,
  /^127\.0\.0\.1(:\d+)?$/i,
  /^\[::1\](:\d+)?$/i,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  // Tailscale/CGNAT (100.64.0.0/10)
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /(^|\.)ngrok-free\.app$/i,
  /(^|\.)ngrok-free\.dev$/i,
  /(^|\.)ngrok\.app$/i,
  /(^|\.)ngrok\.dev$/i,
];

function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first || null;
}

function isAllowedDevHost(host: string): boolean {
  return DEV_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

export function getPublicOrigin(req: Request): string {
  const configured = process.env.NEXTAUTH_URL?.trim().replace(/\/+$/, "");

  if (process.env.NODE_ENV === "production" && configured) {
    return configured;
  }

  const forwardedHost = firstHeaderValue(req.headers.get("x-forwarded-host"));
  const host = forwardedHost ?? firstHeaderValue(req.headers.get("host"));
  const forwardedProto = firstHeaderValue(req.headers.get("x-forwarded-proto"));

  if (host && isAllowedDevHost(host)) {
    const proto = forwardedProto ?? "https";
    return `${proto}://${host}`;
  }

  return configured || new URL(req.url).origin;
}
