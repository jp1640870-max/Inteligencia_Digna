import { NextResponse } from "next/server";
import { getUserById } from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/auth";

export async function GET(req: Request) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const user = getUserById(userId);
  if (!user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture || null,
  });
}
