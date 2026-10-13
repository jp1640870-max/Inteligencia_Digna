import { NextResponse } from "next/server";
import {
  requireCapability,
} from "@/lib/auth";
import {
  getKbCategories,
  createKbCategory,
} from "@/lib/db";
import { logAudit } from "@/lib/db";

export async function GET() {
  const { allowed, status } = await requireCapability("kb.read");
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const categories = await getKbCategories();
  return NextResponse.json({ categories });
}

export async function POST(req: Request) {
  const { allowed, status, user } = await requireCapability("kb.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { label } = await req.json();
  if (!label || typeof label !== "string" || !label.trim()) {
    return NextResponse.json({ error: "El nombre de la categoría es requerido" }, { status: 400 });
  }

  const category = await createKbCategory(label, label);
  if (!category) {
    return NextResponse.json({ error: "No se pudo crear la categoría" }, { status: 500 });
  }
  await logAudit(user.id, "kb.category_create", `Categoría creada: ${category.name}`, "");

  return NextResponse.json({ success: true, category });
}