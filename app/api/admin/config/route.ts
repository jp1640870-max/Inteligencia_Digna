import { NextResponse } from "next/server";
import {
  requireCapability,
} from "@/lib/auth";
import { getAllConfig, setConfig, deleteConfig, logAudit } from "@/lib/db";

export async function GET() {
  const { allowed, status } = await requireCapability("config.read");
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const configs = await getAllConfig();
  return NextResponse.json({ configs });
}

export async function PATCH(req: Request) {
  const { allowed, status, user } = await requireCapability("config.write");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { key, value, description } = await req.json();
  if (!key || value === undefined) {
    return NextResponse.json({ error: "key y value son requeridos" }, { status: 400 });
  }

  await setConfig(key, String(value), description);
  await logAudit(user.id, "config_change", `Config ${key} = ${value}`);
  return NextResponse.json({ success: true });
}

export async function DELETE(req: Request) {
  const { allowed, status } = await requireCapability("config.destroy");
  if (!allowed) {
    return NextResponse.json({ error: "Solo super_admin" }, { status });
  }

  const { key } = await req.json();
  if (!key) {
    return NextResponse.json({ error: "key es requerido" }, { status: 400 });
  }

  await deleteConfig(key);
  return NextResponse.json({ success: true });
}
