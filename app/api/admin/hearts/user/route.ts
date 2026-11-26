import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { getUserHearts } from "@/lib/db";

export async function GET() {
  const { allowed, status } = await requireCapability("hearts.manage");
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const hearts = await getUserHearts();
  return NextResponse.json({ hearts });
}