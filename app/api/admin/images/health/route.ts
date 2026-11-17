import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/auth";
import { query } from "@/lib/db-connection";
import { getImageConfig } from "@/lib/images/config";
import { listImageWorkers } from "@/lib/images/repository";
import { createImageBackend } from "@/lib/images/worker";

export const runtime = "nodejs";

/** Diagnóstico del pipeline de imágenes para el panel de administración. */
export async function GET() {
  const { allowed, status, user } = await requireCapability("panel.read");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const config = getImageConfig();
  const [health, workers, jobs] = await Promise.all([
    createImageBackend().health(),
    listImageWorkers(),
    query<{ status: string; count: string; oldest: string | null }>(
      `SELECT status,
              COUNT(*)::text AS count,
              MIN(created_at)::text AS oldest
         FROM image_jobs
        GROUP BY status
        ORDER BY status`,
    ),
  ]);

  const staleWorkers = workers.filter((worker) => worker.stale).length;
  const activeWorkers = workers.filter(
    (worker) => !worker.stale && worker.status !== "stopped",
  ).length;
  const activeJobs = jobs.rows
    .filter((row) => !["completed", "failed", "cancelled"].includes(row.status))
    .reduce((total, row) => total + Number(row.count), 0);

  return NextResponse.json(
    {
      ok:
        health.ok &&
        activeWorkers > 0 &&
        (config.backend === "mock" || health.ok),
      backend: config.backend,
      comfyUrl: config.comfyUrl,
      health,
      workers: { active: activeWorkers, stale: staleWorkers, items: workers },
      jobs: {
        active: activeJobs,
        byStatus: jobs.rows.map((row) => ({
          status: row.status,
          count: Number(row.count),
          oldest: row.oldest,
        })),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
