import { NextResponse } from "next/server";
import { getUserById } from "@/lib/db";

const DEV_USER_ID = "soporte-dev-user-id";

export async function GET() {
  const user = getUserById(DEV_USER_ID);
  if (!user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
  });
}
