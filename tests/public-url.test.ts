import assert from "node:assert/strict";
import test from "node:test";
import { getPublicOrigin } from "../lib/public-url";

type EnvOverrides = Record<string, string | undefined>;

function withEnv(overrides: EnvOverrides, fn: () => void): void {
  const previous: EnvOverrides = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

test("dev: localhost conserva HTTPS", () => {
  withEnv({ NODE_ENV: "development", NEXTAUTH_URL: "https://localhost:3000" }, () => {
    const req = request("http://localhost:3000/api/auth/google", {
      host: "localhost:3000",
    });
    assert.equal(getPublicOrigin(req), "https://localhost:3000");
  });
});

test("dev: acepta el dominio de ngrok", () => {
  withEnv({ NODE_ENV: "development", NEXTAUTH_URL: "https://localhost:3000" }, () => {
    const req = request("http://localhost:3000/api/auth/google", {
      "x-forwarded-host": "humped-palatable-shell.ngrok-free.dev",
      "x-forwarded-proto": "https",
    });
    assert.equal(
      getPublicOrigin(req),
      "https://humped-palatable-shell.ngrok-free.dev"
    );
  });
});

test("dev: acepta IPs de la LAN", () => {
  withEnv({ NODE_ENV: "development", NEXTAUTH_URL: "https://localhost:3000" }, () => {
    const req = request("http://localhost:3000/api/auth/google", {
      "x-forwarded-host": "192.168.100.3:3000",
      "x-forwarded-proto": "https",
    });
    assert.equal(getPublicOrigin(req), "https://192.168.100.3:3000");
  });
});

test("dev: usa el primer valor de x-forwarded-host", () => {
  withEnv({ NODE_ENV: "development", NEXTAUTH_URL: "https://localhost:3000" }, () => {
    const req = request("http://localhost:3000/api/auth/google", {
      "x-forwarded-host": "foo.ngrok-free.dev, interno.local",
      "x-forwarded-proto": "https, http",
    });
    assert.equal(getPublicOrigin(req), "https://foo.ngrok-free.dev");
  });
});

test("dev: un host desconocido cae a NEXTAUTH_URL", () => {
  withEnv({ NODE_ENV: "development", NEXTAUTH_URL: "https://localhost:3000/" }, () => {
    const req = request("http://localhost:3000/api/auth/google", {
      "x-forwarded-host": "evil.example.com",
      "x-forwarded-proto": "https",
    });
    assert.equal(getPublicOrigin(req), "https://localhost:3000");
  });
});

test("production: NEXTAUTH_URL gana sobre headers falseados", () => {
  withEnv(
    { NODE_ENV: "production", NEXTAUTH_URL: "https://digna.example.com/" },
    () => {
      const req = request("http://app:3000/api/auth/google", {
        "x-forwarded-host": "evil.example.com",
        "x-forwarded-proto": "http",
      });
      assert.equal(getPublicOrigin(req), "https://digna.example.com");
    }
  );
});

test("production: sin NEXTAUTH_URL no confía en x-forwarded-host", () => {
  withEnv({ NODE_ENV: "production", NEXTAUTH_URL: undefined }, () => {
    const req = request("https://internal.example.com/api/auth/google", {
      "x-forwarded-host": "evil.example.com",
      "x-forwarded-proto": "https",
    });
    assert.equal(getPublicOrigin(req), "https://internal.example.com");
  });
});
