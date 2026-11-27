import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { createUser, getUserByEmail, logAudit } from "@/lib/db";
import { hashPassword, signToken } from "@/lib/auth";
import { validateRegistrationEmail } from "@/lib/email-policy";
import { validatePasswordPolicy } from "@/lib/password-policy";
import {
  checkRegistrationLimit,
  consumeRegistrationAttempt,
  getClientIp,
  normalizeIdentifier,
  rateLimitErrorMessage,
  rateLimitHeaders,
  REGISTER_EMAIL_LIMIT,
  REGISTER_IP_LIMIT,
  REGISTER_WINDOW_MS,
} from "@/lib/auth-rate-limit";
import type { RateLimitState } from "@/lib/auth-rate-limit";

function tooManyAttempts(state: RateLimitState) {
  return NextResponse.json(
    { error: rateLimitErrorMessage(state.retryAfterSeconds) },
    { status: 429, headers: rateLimitHeaders(state) },
  );
}

export async function POST(req: Request) {
  try {
    const clientIp = getClientIp(req.headers);
    const { email, password, name } = await req.json();

    // La IP se consume en cada petición, incluso si el cuerpo es inválido: es
    // la barrera contra floods baratos. El email, en cambio, solo se consume
    // después de validar, para que nadie pueda agotar el cupo de un tercero.
    const ipAttempt = await consumeRegistrationAttempt(
      "register_ip",
      clientIp,
      REGISTER_IP_LIMIT,
      REGISTER_WINDOW_MS,
    );
    if (!ipAttempt.allowed) {
      await logAudit(
        null,
        "register_blocked",
        `Registro bloqueado por rate limit (${ipAttempt.scope})`,
        clientIp,
      );
      return tooManyAttempts(ipAttempt);
    }

    const emailKey =
      typeof email === "string" ? normalizeIdentifier(email) : "";
    if (emailKey) {
      const emailLimit = await checkRegistrationLimit(
        "register_email",
        emailKey,
        REGISTER_EMAIL_LIMIT,
        REGISTER_WINDOW_MS,
      );
      if (!emailLimit.allowed) {
        await logAudit(
          null,
          "register_blocked",
          `Registro bloqueado por rate limit (${emailLimit.scope})`,
          clientIp,
        );
        return tooManyAttempts(emailLimit);
      }
    }

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email y contraseña son requeridos" },
        { status: 400 },
      );
    }

    const emailCheck = validateRegistrationEmail(email);
    if (!emailCheck.valid) {
      return NextResponse.json({ error: emailCheck.error }, { status: 400 });
    }

    const passwordCheck = validatePasswordPolicy(password);
    if (!passwordCheck.valid) {
      return NextResponse.json(
        { error: passwordCheck.errors[0], errors: passwordCheck.errors },
        { status: 400 },
      );
    }

    if (emailKey) {
      const emailAttempt = await consumeRegistrationAttempt(
        "register_email",
        emailKey,
        REGISTER_EMAIL_LIMIT,
        REGISTER_WINDOW_MS,
      );
      if (!emailAttempt.allowed) {
        await logAudit(
          null,
          "register_blocked",
          `Registro bloqueado por rate limit (${emailAttempt.scope})`,
          clientIp,
        );
        return tooManyAttempts(emailAttempt);
      }
    }

    const existing = await getUserByEmail(email);
    if (existing) {
      return NextResponse.json(
        { error: "El email ya está registrado" },
        { status: 409 },
      );
    }

    const id = uuidv4();
    const passwordHash = hashPassword(password);
    await createUser(id, email, name || null, passwordHash);

    // El alta ya quedó contabilizada por `consumeRegistrationAttempt`; no se
    // limpia el contador porque eso haría que el límite no limitara nada.
    const role = "user"; // Nuevos registros siempre empiezan como user
    const token = signToken({ userId: id, email, role });
    await logAudit(
      id,
      "register",
      `Nuevo registro: ${email}`,
      clientIp,
    );

    const response = NextResponse.json({
      token,
      user: { id, email, name: name || null, role },
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
