import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getAllConfig, setConfig, deleteConfig, logAudit } from "@/lib/db";

export async function GET() {
  const { allowed } = await requireRole(["super_admin", "admin", "editor", "viewer"]);
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const configs = getAllConfig();
  return NextResponse.json({ configs });
}

export async function PATCH(req: Request) {
  const { allowed, user } = await requireRole(["super_admin", "admin"]);
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { key, value, description } = await req.json();
  if (!key || value === undefined) {
    return NextResponse.json({ error: "key y value son requeridos" }, { status: 400 });
  }

  setConfig(key, String(value), description);
  logAudit(user.id, "config_change", `Config ${key} = ${value}`);
  return NextResponse.json({ success: true });
}

export async function DELETE(req: Request) {
  const { allowed } = await requireRole(["super_admin"]);
  if (!allowed) {
    return NextResponse.json({ error: "Solo super_admin" }, { status: 403 });
  }

  const { key } = await req.json();
  if (!key) {
    return NextResponse.json({ error: "key es requerido" }, { status: 400 });
  }

  deleteConfig(key);
  return NextResponse.json({ success: true });
}
