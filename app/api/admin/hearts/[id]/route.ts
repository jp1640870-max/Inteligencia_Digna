import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import {
  deleteHeartDefinition,
  getHeartDefinitionRecord,
  toHeartAdminItem,
  updateHeartDefinition,
  type HeartActor,
} from "@/lib/heart-registry";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, status, user } = await requireCapability("hearts.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await params;
  const actor: HeartActor = { id: user.id, role: user.role };
  const result = await getHeartDefinitionRecord(id, actor);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(toHeartAdminItem(result.value));
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, status, user } = await requireCapability("hearts.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const actor: HeartActor = { id: user.id, role: user.role };
  const result = await updateHeartDefinition(id, body, actor);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, heart: toHeartAdminItem(result.value) });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, status, user } = await requireCapability("hearts.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await params;
  const actor: HeartActor = { id: user.id, role: user.role };
  const result = await deleteHeartDefinition(id, actor);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true });
}
