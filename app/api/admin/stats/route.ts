import { NextResponse } from "next/server";
import {
  requireCapability,
} from "@/lib/auth";
import { getSystemStats } from "@/lib/db";

export async function GET() {
  const { allowed, status, user } = await requireCapability("panel.read");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const stats = await getSystemStats(user.role);
  return NextResponse.json(stats);
}
