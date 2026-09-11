import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import {
  getKbCategories,
  createKbCategory,
} from "@/lib/db";
import { logAudit } from "@/lib/db";

export async function GET() {
  const { allowed } = await requireRole(["super_admin", "admin", "editor"]);
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const categories = getKbCategories();
  return NextResponse.json({ categories });
}

export async function POST(req: Request) {
  const { allowed, user } = await requireRole(["super_admin", "admin", "editor"]);
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { label } = await req.json();
  if (!label || typeof label !== "string" || !label.trim()) {
    return NextResponse.json({ error: "El nombre de la categoría es requerido" }, { status: 400 });
  }

  const category = createKbCategory(label, label);
  logAudit(user.id, "kb.category_create", `Categoría creada: ${category.name}`, "");

  return NextResponse.json({ success: true, category });
}