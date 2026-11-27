import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { applyHeartStatusAction } from "@/lib/heart-lifecycle";
import { toHeartAdminItem, type HeartActor } from "@/lib/heart-registry";
import { isHeartAction, type HeartAction } from "@/lib/heart-registry-rules";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, status, user } = await requireCapability("hearts.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }
  const rawAction = (body as Record<string, unknown>).action;
  if (!isHeartAction(rawAction)) {
    return NextResponse.json({ error: "Acción de estado inválida" }, { status: 400 });
  }
  const changeSummary = (body as Record<string, unknown>).changeSummary;
  const actor: HeartActor = { id: user.id, role: user.role };
  const result = await applyHeartStatusAction(
    id,
    rawAction as HeartAction,
    actor,
    typeof changeSummary === "string" ? changeSummary : "",
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ success: true, heart: toHeartAdminItem(result.value) });
}
