import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { isHeartStatus } from "@/lib/heart-definition";
import {
  listHeartDefinitions,
  toHeartAdminItem,
  type HeartActor,
} from "@/lib/heart-registry";

export async function GET(req: Request) {
  const { allowed, status, user } = await requireCapability("hearts.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const params = new URL(req.url).searchParams;
  const rawStatus = params.get("status");
  const actor: HeartActor = { id: user.id, role: user.role };
  const result = await listHeartDefinitions(actor, {
    scope: "personal",
    status: isHeartStatus(rawStatus) ? rawStatus : null,
    search: params.get("q"),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ hearts: result.value.map(toHeartAdminItem) });
}
