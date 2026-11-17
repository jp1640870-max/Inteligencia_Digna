export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import {
  getJobWithImageForUser,
  toImageJobMeta,
} from "@/lib/images/repository";

/** Estado persistente de un trabajo; el cliente lo consulta para actualizar la tarjeta. */
export async function GET(
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

  const details = await getJobWithImageForUser(id, userId);
  if (!details) {
    return NextResponse.json({ error: "Trabajo no encontrado" }, { status: 404 });
  }

  return NextResponse.json(
    {
      job: toImageJobMeta(details.job, details.image ?? undefined),
      assistantText:
        details.job.status === "completed"
          ? "Imagen generada."
          : details.job.status === "failed"
            ? "No se pudo generar la imagen."
            : details.job.status === "cancelled"
              ? "Generación de imagen cancelada."
              : "Generando imagen…",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
