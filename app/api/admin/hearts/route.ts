import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { requireCapability } from "@/lib/auth";
import { createHeart, getCompanyHearts, logAudit } from "@/lib/db";
import { ensureOfficialSupportHeart, sanitizeHeartInput } from "@/lib/hearts";

export async function GET() {
  const { allowed, status, user } = await requireCapability("hearts.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  try {
    await ensureOfficialSupportHeart(user.id);
  } catch {
    // El panel debe seguir mostrando los Hearts aunque falle la creación.
  }

  const hearts = await getCompanyHearts();
  return NextResponse.json({ hearts });
}

export async function POST(req: Request) {
  const { allowed, status, user } = await requireCapability("hearts.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const body = await req.json().catch(() => null);
  const sanitized = sanitizeHeartInput(body);
  if (!sanitized.ok) {
    return NextResponse.json({ error: sanitized.error }, { status: 400 });
  }

  const isFeatured = Boolean(
    body &&
      typeof body === "object" &&
      ("isFeatured" in body ? body.isFeatured : "is_featured" in body ? body.is_featured : false),
  );

  const id = uuidv4();
  await createHeart(
    id,
    user.id,
    sanitized.value.name,
    sanitized.value.role,
    sanitized.value.tone,
    sanitized.value.instructions,
    sanitized.value.limitations,
    sanitized.value.temperature,
    sanitized.value.tools,
    1,
    isFeatured,
    "company",
  );

  await logAudit(
    user.id,
    "create_heart",
    `Heart de empresa creado: ${sanitized.value.name}${isFeatured ? " (fijado)" : ""}`,
  );
  return NextResponse.json({ success: true, id });
}
