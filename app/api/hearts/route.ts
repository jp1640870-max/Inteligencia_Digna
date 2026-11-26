import { NextResponse } from "next/server";
import { getAuthUserFromRequest } from "@/lib/auth";
import {
  ensureOfficialSupportHeart,
  insertHeart,
  listHeartsForUser,
  sanitizeHeartInput,
} from "@/lib/hearts";

export async function GET() {
  const authUser = await getAuthUserFromRequest();
  if (!authUser) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const userId = authUser.id;

  // La tarjeta oficial de Soporte debe existir una sola vez y ser visible para
  // todos. La creación es idempotente y no altera un Heart ya vinculado.
  try {
    await ensureOfficialSupportHeart(userId);
  } catch {
    // Si falla la creación, la lista de Hearts sigue siendo utilizable.
  }

  const agents = await listHeartsForUser(userId);
  return NextResponse.json({ agents });
}

export async function POST(req: Request) {
  const authUser = await getAuthUserFromRequest();
  if (!authUser) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const userId = authUser.id;

  const body = await req.json().catch(() => null);
  const sanitized = sanitizeHeartInput(body);
  if (!sanitized.ok) {
    return NextResponse.json({ error: sanitized.error }, { status: 400 });
  }

  const agent = await insertHeart(userId, sanitized.value);
  return NextResponse.json({ agent });
}
