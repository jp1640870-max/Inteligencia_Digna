import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Integración del rate limiting contra PostgreSQL.
 *
 * Forma parte del glob `tests/*.test.ts`, pero el runner solo lo ejecuta con
 * `npm run test:db` (sufijo `-db.test.ts`). Carga `.env` a mano porque el
 * runner de tests solo inyecta `tests/.env.test`.
 */

function loadEnvironment(): void {
  for (const fileName of [".env"]) {
    const filePath = resolve(process.cwd(), fileName);
    if (existsSync(filePath)) process.loadEnvFile(filePath);
  }
}

loadEnvironment();

const hasDatabase = () => Boolean(process.env.DATABASE_URL);

describe(
  "rate limiting de autenticación contra Postgres",
  { skip: hasDatabase() ? false : "sin DATABASE_URL" },
  () => {
    const prefix = `test-${randomUUID()}`;
    let limits: typeof import("../lib/auth-rate-limit.js");
    let query: typeof import("../lib/db-connection.js").query;

    before(async () => {
      limits = await import("../lib/auth-rate-limit.js");
      query = (await import("../lib/db-connection.js")).query;
    });

    after(async () => {
      await query("DELETE FROM auth_rate_limits WHERE identifier LIKE $1", [
        `${prefix}%`,
      ]);
    });

    it("bloquea el login al quinto fallo y lo libera tras un login correcto", async () => {
      const identifier = `${prefix}-login`;

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const result = await limits.recordLoginFailure("login_ip", identifier);
        assert.equal(result.allowed, true, `el fallo ${attempt} no debía bloquear`);
      }

      const fifth = await limits.recordLoginFailure("login_ip", identifier);
      assert.equal(fifth.allowed, false);
      assert.ok(fifth.retryAfterSeconds > 0);

      const blocked = await limits.checkLoginLimit("login_ip", identifier);
      assert.equal(blocked.allowed, false);
      assert.ok(blocked.retryAfterSeconds > 0);

      await limits.recordLoginSuccess("login_ip", identifier);
      const afterSuccess = await limits.checkLoginLimit("login_ip", identifier);
      assert.equal(afterSuccess.allowed, true);
      assert.equal(afterSuccess.remaining, limits.LOGIN_FIRST_THRESHOLD);
    });

    it("cuenta ventanas separadas por IP y por email en el registro", async () => {
      const ip = `${prefix}-register-ip`;
      const email = `${prefix}-register-email`;

      for (let attempt = 1; attempt <= limits.REGISTER_IP_LIMIT; attempt += 1) {
        const result = await limits.consumeRegistrationAttempt(
          "register_ip",
          ip,
          limits.REGISTER_IP_LIMIT,
          limits.REGISTER_WINDOW_MS,
        );
        assert.equal(result.allowed, true, `el intento ${attempt} debía pasar`);
      }

      const blockedIp = await limits.consumeRegistrationAttempt(
        "register_ip",
        ip,
        limits.REGISTER_IP_LIMIT,
        limits.REGISTER_WINDOW_MS,
      );
      assert.equal(blockedIp.allowed, false);
      assert.ok(blockedIp.retryAfterSeconds > 0);
      assert.equal(
        (await limits.checkRegistrationLimit(
          "register_ip",
          ip,
          limits.REGISTER_IP_LIMIT,
          limits.REGISTER_WINDOW_MS,
        )).allowed,
        false,
      );

      for (let attempt = 1; attempt <= limits.REGISTER_EMAIL_LIMIT; attempt += 1) {
        const result = await limits.consumeRegistrationAttempt(
          "register_email",
          email,
          limits.REGISTER_EMAIL_LIMIT,
          limits.REGISTER_WINDOW_MS,
        );
        assert.equal(result.allowed, true, `el intento ${attempt} debía pasar`);
      }

      const blockedEmail = await limits.consumeRegistrationAttempt(
        "register_email",
        email,
        limits.REGISTER_EMAIL_LIMIT,
        limits.REGISTER_WINDOW_MS,
      );
      assert.equal(blockedEmail.allowed, false);
      assert.ok(blockedEmail.retryAfterSeconds > 0);
    });

    it("serializa fallos concurrentes sin perder el contador", async () => {
      const identifier = `${prefix}-concurrent`;

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          limits.recordLoginFailure("login_account", identifier),
        ),
      );
      assert.ok(results.some((result) => !result.allowed));

      const row = await query<{ failures: number }>(
        "SELECT failures FROM auth_rate_limits WHERE scope = $1 AND identifier = $2",
        ["login_account", identifier],
      );
      assert.equal(row.rows[0]?.failures, 10);

      const blocked = await limits.checkLoginLimit(
        "login_account",
        identifier,
      );
      assert.equal(blocked.allowed, false);
    });
  },
);
