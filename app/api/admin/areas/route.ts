import { NextResponse } from "next/server";
import {
  requireCapability,
} from "@/lib/auth";
import { createArea, getAreaById, getAreas, logAudit } from "@/lib/db";

/**
 * Áreas = unidades organizacionales que conceden acceso a la KB.
 *
 * Crear un área no da acceso a nada por sí sola: hay que otorgarle grants sobre
 * archivos concretos. Es deliberado, para que "dar de alta a alguien en el área"
 * y "que vea este documento" sigan siendo decisiones separadas y auditables.
 */
export async function GET() {
  const { allowed, status } = await requireCapability("org.read");
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const areas = await getAreas();
  return NextResponse.json({ areas });
}

/** Crear un área es tarea del perímetro: define a qué puede acceder la gente. */
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
    return NextResponse.json({ error: "El nombre del área es requerido" }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json({ error: "No se pudo derivar una clave del nombre" }, { status: 400 });
  }

  const parentId = typeof body.parentId === "string" && body.parentId ? body.parentId : null;
  if (parentId) {
    const parent = await getAreaById(parentId);
    if (!parent) {
      return NextResponse.json({ error: "El área padre no existe" }, { status: 400 });
    }
    if (parent.parent_id) {
      return NextResponse.json(
        { error: "Solo se admite un nivel de jerarquía: el área padre ya tiene padre" },
        { status: 400 },
      );
    }
  }

  try {
    const area = await createArea({ key, name, description, parentId });
    await logAudit(user.id, "area.create", `Área creada: ${area.name} (${area.key})`, "");
    return NextResponse.json({ success: true, area });
  } catch (error) {
    // 23505 = unique_violation sobre areas.key
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "Ya existe un área con esa clave" }, { status: 409 });
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
