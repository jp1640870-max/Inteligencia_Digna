export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import {
  requestJobCancellation,
  toImageJobMeta,
} from "@/lib/images/repository";

/**
 * Solicita cancelar un trabajo.
 *
 * Si aún no tiene prompt_id se cancela en el acto. Si ya está en ComfyUI se
 * marca la bandera y el worker hace una cancelación dirigida; nunca se llama a
 * /interrupt sin prompt_id porque eso interrumpiría otro trabajo.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Trabajo no encontrado" }, { status: 404 });
  }

  const job = await requestJobCancellation(id, userId);
  if (!job) {
    return NextResponse.json({ error: "Trabajo no encontrado" }, { status: 404 });
  }

  return NextResponse.json(
    {
      job: toImageJobMeta(job),
      pending: job.status === "generating" || job.status === "saving",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
