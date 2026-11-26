/**
 * Dominio permitido para dar de alta usuarios.
 *
 * Puro y sin dependencias de Next para poder usarlo tanto en las rutas como en
 * los scripts y en los tests. El valor por defecto es un dominio genérico;
 * `ALLOWED_EMAIL_DOMAIN` permite cambiarlo sin tocar el código.
 */

export const DEFAULT_ALLOWED_EMAIL_DOMAIN = "example.org";

export function getAllowedEmailDomain(): string {
  const configured = process.env.ALLOWED_EMAIL_DOMAIN || DEFAULT_ALLOWED_EMAIL_DOMAIN;
  return configured.trim().toLowerCase().replace(/^@/, "");
}

export type EmailValidationResult = {
  valid: boolean;
  error: string | null;
};

export function validateRegistrationEmail(
  email: unknown,
  allowedDomain = getAllowedEmailDomain(),
): EmailValidationResult {
  if (typeof email !== "string") {
    return { valid: false, error: "Correo electrónico inválido" };
  }

  const normalized = email.trim().toLowerCase();
  const at = normalized.indexOf("@");
  const hasSingleAt = at > 0 && at === normalized.lastIndexOf("@") && at < normalized.length - 1;
  if (!hasSingleAt) {
    return { valid: false, error: "Correo electrónico inválido" };
  }

  if (normalized.slice(at + 1) !== allowedDomain.toLowerCase()) {
    return {
      valid: false,
      error: `Solo se permiten correos @${allowedDomain}`,
    };
  }

  return { valid: true, error: null };
}

export function isAllowedEmailDomain(email: unknown, allowedDomain = getAllowedEmailDomain()): boolean {
  return validateRegistrationEmail(email, allowedDomain).valid;
}
