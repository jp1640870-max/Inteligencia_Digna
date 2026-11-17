import { existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvironment(): void {
  const filePath = resolve(process.cwd(), ".env");
  if (existsSync(filePath)) process.loadEnvFile(filePath);
}

function color(ok: boolean): string {
  return ok ? "OK" : "FALLO";
}

async function main(): Promise<void> {
  loadEnvironment();
  const [{ createImageBackend }, { getImageConfig }, { getPool }] = await Promise.all([
    import("../lib/images/worker"),
    import("../lib/images/config"),
    import("../lib/db-connection"),
  ]);
  const config = getImageConfig();
  const backend = createImageBackend();
  const workerOnly = process.argv.includes("--worker-only");

  const [health, db] = await Promise.all([
    workerOnly
      ? Promise.resolve({
          ok: true,
          url: "(omitido por --worker-only)",
          workflowConfigured: Boolean(config.comfyWorkflow),
          workflowReadable: false,
          error: undefined as string | undefined,
        })
      : backend.health(),
    (async () => {
      const worker = await getPool().query<{
        total: string;
        fresh: string;
        busy: string;
      }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (
                  WHERE heartbeat_at > NOW() - ($1::int * INTERVAL '1 millisecond')
                )::text AS fresh,
                COUNT(*) FILTER (WHERE status = 'busy')::text AS busy
           FROM image_workers`,
        [config.workerStaleMs],
      );
      const jobs = await getPool().query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::text AS count
           FROM image_jobs
          GROUP BY status
          ORDER BY status`,
      );
      return {
        workers: worker.rows[0] ?? { total: "0", fresh: "0", busy: "0" },
        jobs: jobs.rows,
      };
    })(),
  ]);

  const freshWorkers = Number(db.workers.fresh || 0);
  console.log(`backend: ${backend.name}`);
  console.log(`ComfyUI: ${health.url} (${color(health.ok)})`);
  console.log(
    `workflow: configurado=${health.workflowConfigured} legible=${health.workflowReadable}`,
  );
  if (health.error) console.log(`error ComfyUI: ${health.error}`);
  console.log(
    `workers: ${freshWorkers} fresco(s) de ${db.workers.total}, ${db.workers.busy} ocupado(s)`,
  );
  console.log(
    `trabajos: ${db.jobs.length > 0 ? db.jobs.map((row) => `${row.status}=${row.count}`).join(", ") : "ninguno"}`,
  );

  if (!health.ok || freshWorkers === 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(
      "[image-health] error:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end().catch(() => undefined);
  });
