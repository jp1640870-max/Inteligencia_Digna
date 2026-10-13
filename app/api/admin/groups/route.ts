import { NextResponse } from "next/server";
import {
  requireCapability,
} from "@/lib/auth";
import { createUserGroup, getUserGroups, logAudit } from "@/lib/db";

/**
 * Grupos = navegación transversal. Un grupo concede los mismos grants que un
 * área, así que sirve para que un documento llegue a varias áreas sin duplicar
 * la lista de miembros.
 */
export async function GET() {
  const { allowed, status } = await requireCapability("org.read");
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const groups = await getUserGroups();
  return NextResponse.json({ groups });
}

export async function POST(req: Request) {
  const { allowed, status, user } = await requireCapability("org.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const key = typeof body.key === "string" && body.key.trim() ? body.key.trim() : slug(name);

  if (!name) {
    return NextResponse.json({ error: "El nombre del grupo es requerido" }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json({ error: "No se pudo derivar una clave del nombre" }, { status: 400 });
  }

  try {
    const group = await createUserGroup({ key, name, description });
    await logAudit(user.id, "group.create", `Grupo creado: ${group.name} (${group.key})`, "");
    return NextResponse.json({ success: true, group });
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "Ya existe un grupo con esa clave" }, { status: 409 });
    }
    throw error;
  }
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
