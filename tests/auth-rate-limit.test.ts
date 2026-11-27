import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LOGIN_RESET_MS,
  REGISTER_EMAIL_LIMIT,
  REGISTER_IP_LIMIT,
  REGISTER_WINDOW_MS,
  getClientIp,
  getClientIpFromForwardedFor,
  loginBlockDurationMs,
  loginBlockLevel,
  mostRestrictiveBlock,
  normalizeIdentifier,
  rateLimitErrorMessage,
  rateLimitHeaders,
} from "../lib/auth-rate-limit.js";
import type { RateLimitState } from "../lib/auth-rate-limit.js";

function state(overrides: Partial<RateLimitState> = {}): RateLimitState {
  return {
    allowed: true,
    scope: "login_ip",
    limit: 5,
    remaining: 5,
    retryAfterSeconds: 0,
    resetInSeconds: 0,
    ...overrides,
  };
}

describe("política de bloqueo progresivo del login", () => {
  it("no bloquea antes del primer umbral", () => {
    for (const failures of [0, 1, 4]) {
      assert.equal(loginBlockDurationMs(failures), 0);
      assert.equal(loginBlockLevel(failures), 0);
    }
  });

  it("aplica 1, 5 y 15 minutos en 5, 10 y 20 fallos", () => {
    assert.equal(loginBlockDurationMs(5), 60_000);
    assert.equal(loginBlockDurationMs(9), 60_000);
    assert.equal(loginBlockDurationMs(10), 5 * 60_000);
    assert.equal(loginBlockDurationMs(19), 5 * 60_000);
    assert.equal(loginBlockDurationMs(20), 15 * 60_000);
    assert.equal(loginBlockDurationMs(39), 15 * 60_000);
  });

  it("tiene un tope de una hora a partir de 40 fallos", () => {
    assert.equal(loginBlockDurationMs(40), 60 * 60_000);
    assert.equal(loginBlockDurationMs(500), 60 * 60_000);
  });

  it("el nivel cuenta los escalones superados", () => {
    assert.equal(loginBlockLevel(5), 1);
    assert.equal(loginBlockLevel(10), 2);
    assert.equal(loginBlockLevel(20), 3);
    assert.equal(loginBlockLevel(40), 4);
  });

  it("la ventana de login se reinicia tras una hora", () => {
    assert.equal(LOGIN_RESET_MS, 60 * 60_000);
  });
});

describe("normalización de claves", () => {
  it("normaliza el email igual que la búsqueda en base de datos", () => {
    assert.equal(normalizeIdentifier("  Juan.Rochin@Example.ORG "), "juan.rochin@example.org");
  });

  it("tolera valores ya normalizados", () => {
    assert.equal(normalizeIdentifier("persona@example.org"), "persona@example.org");
  });
});

describe("IP del cliente", () => {
  it("toma el último valor de X-Forwarded-For (el que añade el proxy)", () => {
    assert.equal(
      getClientIpFromForwardedFor("203.0.113.9, 198.51.100.7"),
      "198.51.100.7",
    );
  });

  it("ignora valores inválidos y acepta IPv4 con puerto o IPv6 entre corchetes", () => {
    assert.equal(getClientIpFromForwardedFor("no-es-ip"), null);
    assert.equal(getClientIpFromForwardedFor("198.51.100.7:443"), "198.51.100.7");
    assert.equal(getClientIpFromForwardedFor("[2001:db8::1]:443"), "2001:db8::1");
  });

  it("usa X-Real-IP como fallback y 'unknown' si no hay ninguna", () => {
    assert.equal(
      getClientIp(new Headers({ "x-real-ip": "198.51.100.7" })),
      "198.51.100.7",
    );
    assert.equal(getClientIp(new Headers()), "unknown");
  });

  it("prioriza X-Forwarded-For sobre X-Real-IP", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.9",
      "x-real-ip": "198.51.100.7",
    });
    assert.equal(getClientIp(headers), "203.0.113.9");
  });
});

describe("respuesta de rate limit", () => {
  it("elige el bloqueo más largo", () => {
    const short = state({
      allowed: false,
      retryAfterSeconds: 60,
    });
    const long = state({
      allowed: false,
      scope: "login_account",
      retryAfterSeconds: 300,
    });
    assert.equal(mostRestrictiveBlock(short, null, long), long);
    assert.equal(mostRestrictiveBlock(state(), null), null);
  });

  it("incluye Retry-After y cabeceras X-RateLimit", () => {
    const headers = rateLimitHeaders(
      state({
        allowed: false,
        limit: 5,
        remaining: 0,
        retryAfterSeconds: 90,
        resetInSeconds: 90,
      }),
    );
    assert.deepEqual(headers, {
      "Retry-After": "90",
      "X-RateLimit-Limit": "5",
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": "90",
    });
  });

  it("redacta segundos o minutos según la espera", () => {
    assert.match(rateLimitErrorMessage(45), /45 s/);
    assert.match(rateLimitErrorMessage(90), /2 min/);
    assert.match(rateLimitErrorMessage(0), /1 s/);
  });

  it("las ventanas de registro duran una hora con sus límites", () => {
    assert.equal(REGISTER_WINDOW_MS, 60 * 60_000);
    assert.equal(REGISTER_IP_LIMIT, 5);
    assert.equal(REGISTER_EMAIL_LIMIT, 3);
  });
});
