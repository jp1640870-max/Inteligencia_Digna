import { NextResponse } from "next/server";
import { getUserByEmail, logAudit } from "@/lib/db";
import { verifyPassword, signToken, isUserRole } from "@/lib/auth";
import {
  checkLoginLimit,
  getClientIp,
  mostRestrictiveBlock,
  normalizeIdentifier,
  rateLimitErrorMessage,
  rateLimitHeaders,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/auth-rate-limit";
import type { RateLimitState } from "@/lib/auth-rate-limit";

/**
 * Hash señuelo para igualar el tiempo de respuesta cuando el email no existe.
 *
 * Sin esto, un atacante puede distinguir una cuenta válida de una inexistente
 * midiendo cuánto tarda la petición: la comparación real solo se ejecuta si el
 * usuario existe. El resultado de esta comparación se ignora a propósito.
 */
const DUMMY_PASSWORD_HASH =
  "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

function tooManyAttempts(state: RateLimitState) {
  return NextResponse.json(
    { error: rateLimitErrorMessage(state.retryAfterSeconds) },
    { status: 429, headers: rateLimitHeaders(state) },
  );
}

/**
 * Cuenta el fallo en IP y cuenta, y responde 429 si ese fallo cruzó un umbral.
 *
 * El mensaje de credenciales es siempre el mismo para no filtrar si el email
 * existe. El bloqueo se aplica después de registrar el fallo para que el
 * intento que llega al límite ya reciba `Retry-After`.
 */
async function invalidCredentials(clientIp: string, accountKey: string) {
  const [ipState, accountState] = await Promise.all([
    recordLoginFailure("login_ip", clientIp),
    accountKey
      ? recordLoginFailure("login_account", accountKey)
      : Promise.resolve(null),
  ]);
  const blocked = mostRestrictiveBlock(ipState, accountState);
  if (blocked) {
    await logAudit(
      null,
      "login_blocked",
      `Login bloqueado por rate limit (${blocked.scope})`,
      clientIp,
    );
    return tooManyAttempts(blocked);
  }

  return NextResponse.json(
    { error: "Credenciales inválidas" },
    { status: 401 },
  );
}

export async function POST(req: Request) {
  try {
    const clientIp = getClientIp(req.headers);
    const { email, password } = await req.json();

    const accountKey =
      typeof email === "string" ? normalizeIdentifier(email) : "";
    const [ipLimit, accountLimit] = await Promise.all([
      checkLoginLimit("login_ip", clientIp),
      accountKey
        ? checkLoginLimit("login_account", accountKey)
        : Promise.resolve(null),
    ]);
    const blocked = mostRestrictiveBlock(ipLimit, accountLimit);
    if (blocked) {
      await logAudit(
        null,
        "login_blocked",
        `Login bloqueado por rate limit (${blocked.scope})`,
        clientIp,
      );
      return tooManyAttempts(blocked);
    }

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email ||
      !password
    ) {
      return NextResponse.json(
        { error: "Email y contraseña son requeridos" },
        { status: 400 },
      );
    }

    const user = await getUserByEmail(email);
    if (!user || !user.password_hash) {
      // Misma carga de trabajo que un usuario real para no filtrar por tiempo.
      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      return invalidCredentials(clientIp, accountKey);
    }

    if (!(await verifyPassword(password, user.password_hash))) {
      return invalidCredentials(clientIp, accountKey);
    }

    const role = user.role || "user";
    if (!isUserRole(role)) {
      return invalidCredentials(clientIp, accountKey);
    }

    await Promise.all([
      recordLoginSuccess("login_ip", clientIp),
      recordLoginSuccess("login_account", accountKey),
    ]);

    const token = signToken({ userId: user.id, email: user.email, role });

    await logAudit(
      user.id,
      "login",
      `Login exitoso: ${user.email}`,
      clientIp,
    );

    const response = NextResponse.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role,
      },
    });

    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });

    return response;
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
