import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { ensureOfficialSupportHeart } from "@/lib/hearts";
import {
  createHeartDefinition,
  listHeartDefinitions,
  toHeartAdminItem,
  type HeartActor,
} from "@/lib/heart-registry";
import { isHeartScope, isHeartStatus } from "@/lib/heart-definition";

export async function GET(req: Request) {
  const { allowed, status, user } = await requireCapability("hearts.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  try {
    await ensureOfficialSupportHeart(user.id);
  } catch {
    // El panel debe seguir mostrando los Hearts aunque falle el seed.
  }

  const params = new URL(req.url).searchParams;
  const rawScope = params.get("scope");
  const rawStatus = params.get("status");
  const actor: HeartActor = { id: user.id, role: user.role };
  const result = await listHeartDefinitions(actor, {
    scope: isHeartScope(rawScope) ? rawScope : null,
    status: isHeartStatus(rawStatus) ? rawStatus : null,
    search: params.get("q"),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ hearts: result.value.map(toHeartAdminItem) });
}

export async function POST(req: Request) {
  const { allowed, status, user } = await requireCapability("hearts.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const actor: HeartActor = { id: user.id, role: user.role };
  const result = await createHeartDefinition(
    {
      ...(body as Record<string, unknown>),
      scope: "company",
    },
    actor,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    id: result.value.definition.id,
    heart: toHeartAdminItem(result.value),
  });
}
