import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { requireRole } from "@/lib/auth";
import { getBackups, logAudit } from "@/lib/db";
import { runBackup } from "@/lib/backup";

export async function GET() {
  const { allowed } = await requireRole(["super_admin", "admin"]);
  if (!allowed) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const backups = getBackups();
  return NextResponse.json({ backups });
}

export async function POST(req: Request) {
  const { allowed, user } = await requireRole(["super_admin", "admin"]);
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const backupId = uuidv4();
  try {
    const filename = await runBackup(backupId, user.id);
    logAudit(user.id, "backup", `Backup creado: ${filename}`);
    return NextResponse.json({ success: true, id: backupId, filename });
  } catch (e: any) {
    logAudit(user.id, "backup", `Backup FALLIDO: ${e.message}`);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
