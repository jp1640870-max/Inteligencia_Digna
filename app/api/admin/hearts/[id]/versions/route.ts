import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { listHeartVersions } from "@/lib/heart-versions";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, status } = await requireCapability("hearts.manage");
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await params;
  try {
    const versions = await listHeartVersions(id);
    return NextResponse.json({
      versions: versions.map((version) => ({
        version: version.version,
        createdAt: version.createdAt,
        authorId: version.authorId,
        changeSummary: version.changeSummary,
        snapshot: version.snapshot,
      })),
    });
  } catch {
    return NextResponse.json({ error: "No se pudieron leer las versiones" }, { status: 500 });
  }
}
