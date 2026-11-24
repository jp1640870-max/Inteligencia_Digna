/**
 * Política de contraseñas.
 *
 * Módulo puro (sin Next, sin base de datos) para que la misma regla la apliquen
 * el registro, el panel de administración, los scripts y la UI. La validación
 * del servidor es la autoridad; el cliente solo muestra los requisitos.
 */

export const PASSWORD_MIN_LENGTH = 12;

export const PASSWORD_REQUIREMENTS_TEXT =
  "Mínimo 12 caracteres, con mayúscula, minúscula y un carácter especial (por ejemplo @, . o !)";

export type PasswordPolicyResult = {
  valid: boolean;
  errors: string[];
};

export function validatePasswordPolicy(password: unknown): PasswordPolicyResult {
  if (typeof password !== "string" || password.length === 0) {
    return { valid: false, errors: ["La contraseña es requerida"] };
  }

  const errors: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`);
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Debe incluir al menos una mayúscula");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Debe incluir al menos una minúscula");
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push("Debe incluir al menos un carácter especial (por ejemplo @, . o !)");
  }

  return { valid: errors.length === 0, errors };
}

/** Primer error en español, listo para devolver en una respuesta HTTP. */
export function passwordPolicyError(password: unknown): string | null {
  return validatePasswordPolicy(password).errors[0] ?? null;
}
