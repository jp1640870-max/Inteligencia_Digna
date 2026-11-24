import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ALLOWED_EMAIL_DOMAIN,
  getAllowedEmailDomain,
  isAllowedEmailDomain,
  validateRegistrationEmail,
} from "../lib/email-policy.js";
import { isGoogleOAuthEnabled } from "../lib/google-oauth.js";
import {
  PASSWORD_MIN_LENGTH,
  passwordPolicyError,
  validatePasswordPolicy,
} from "../lib/password-policy.js";

describe("dominio permitido para altas", () => {
  it("acepta el dominio institucional sin importar mayúsculas ni espacios", () => {
    const result = validateRegistrationEmail(`  Nombre.Apellido@${DEFAULT_ALLOWED_EMAIL_DOMAIN.toUpperCase()}  `);
    assert.deepEqual(result, { valid: true, error: null });
    assert.equal(isAllowedEmailDomain(`usuario@${DEFAULT_ALLOWED_EMAIL_DOMAIN}`), true);
  });

  it("acepta un dominio configurado explícitamente", () => {
    assert.equal(validateRegistrationEmail("persona@otro.org", "otro.org").valid, true);
  });

  it("rechaza dominios distintos, subdominios y suplantaciones", () => {
    for (const email of [
      "persona@gmail.com",
      `persona@sub.${DEFAULT_ALLOWED_EMAIL_DOMAIN}`,
      `persona@${DEFAULT_ALLOWED_EMAIL_DOMAIN}.evil.com`,
      `persona@evil.com?@${DEFAULT_ALLOWED_EMAIL_DOMAIN}`,
    ]) {
      assert.equal(validateRegistrationEmail(email).valid, false, `debía rechazar ${email}`);
    }
  });

  it("rechaza correos mal formados y valores no string", () => {
    for (const email of ["", "persona", `@${DEFAULT_ALLOWED_EMAIL_DOMAIN}`, `a@@${DEFAULT_ALLOWED_EMAIL_DOMAIN}`, "persona@", null, 42]) {
      assert.equal(validateRegistrationEmail(email).valid, false, `debía rechazar ${String(email)}`);
    }
  });

  it("lee ALLOWED_EMAIL_DOMAIN del entorno con valor por defecto", () => {
    const previous = process.env.ALLOWED_EMAIL_DOMAIN;
    try {
      delete process.env.ALLOWED_EMAIL_DOMAIN;
      assert.equal(getAllowedEmailDomain(), DEFAULT_ALLOWED_EMAIL_DOMAIN);
      process.env.ALLOWED_EMAIL_DOMAIN = "@Otro.Org ";
      assert.equal(getAllowedEmailDomain(), "otro.org");
      assert.equal(isAllowedEmailDomain("persona@otro.org"), true);
    } finally {
      if (previous === undefined) delete process.env.ALLOWED_EMAIL_DOMAIN;
      else process.env.ALLOWED_EMAIL_DOMAIN = previous;
    }
  });
});

describe("política de contraseñas", () => {
  it("acepta contraseñas que cumplen todos los requisitos", () => {
    for (const password of ["Abcdef12@xyz", "Mi.Clave!Segura", "Clave2026#Segura", "Aa1.........."]) {
      assert.deepEqual(validatePasswordPolicy(password), { valid: true, errors: [] });
      assert.equal(passwordPolicyError(password), null);
    }
  });

  it("rechaza longitud insuficiente", () => {
    const result = validatePasswordPolicy("Ab1@short");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes(String(PASSWORD_MIN_LENGTH))));
  });

  it("exige mayúscula, minúscula y carácter especial", () => {
    const cases = new Map<string, string>([
      ["sin mayúscula", "abcdef12@xyz"],
      ["sin minúscula", "ABCDEF12@XYZ"],
      ["sin especial", "Abcdef12xyzA"],
    ]);
    for (const [label, password] of cases) {
      const result = validatePasswordPolicy(password);
      assert.equal(result.valid, false, label);
      assert.equal(result.errors.length, 1, label);
      assert.ok(passwordPolicyError(password), label);
    }
  });

  it("devuelve todos los errores cuando faltan varios requisitos", () => {
    const result = validatePasswordPolicy("abc");
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 3);
  });

  it("rechaza valores ausentes o no string", () => {
    for (const value of ["", undefined, null, 123456]) {
      assert.equal(validatePasswordPolicy(value).valid, false);
    }
  });
});

describe("flag de Google OAuth", () => {
  it("está deshabilitado por defecto y solo se activa con true explícito", () => {
    assert.equal(isGoogleOAuthEnabled(undefined), false);
    assert.equal(isGoogleOAuthEnabled(""), false);
    assert.equal(isGoogleOAuthEnabled("false"), false);
    assert.equal(isGoogleOAuthEnabled("1"), false);
    assert.equal(isGoogleOAuthEnabled("true"), true);
    assert.equal(isGoogleOAuthEnabled(" TRUE "), true);
  });
});
