import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getSystemStats } from "@/lib/db";
import { getAgentModel, getChatModel, getEmbeddingModel, listOllamaModels } from "@/lib/ollama";
import { checkBucket } from "@/lib/storage";

export async function GET() {
  const { allowed } = await requireRole(["super_admin", "admin", "editor", "viewer"]);
  if (!allowed) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const checks: Record<string, { status: "ok" | "error"; detail?: string; latency?: number }> = {};
  try {
    const started = Date.now();
    await getSystemStats();
    checks.database = { status: "ok", latency: Date.now() - started };
  } catch (error) {
    checks.database = { status: "error", detail: String(error) };
  }

  try {
    const started = Date.now();
    const models = await listOllamaModels();
    const required = [getChatModel(), getAgentModel(), getEmbeddingModel()];
    const missing = required.filter((model) => !models.includes(model));
    if (missing.length > 0) {
      checks.ollama = { status: "error", detail: `Modelos faltantes: ${missing.join(", ")}` };
    } else {
      checks.ollama = { status: "ok", latency: Date.now() - started, detail: models.join(", ") };
    }
  } catch (error) {
    checks.ollama = { status: "error", detail: String(error) };
  }

  try {
    const started = Date.now();
    const available = await checkBucket();
    checks.storage = available
      ? { status: "ok", latency: Date.now() - started }
      : { status: "error", detail: "Bucket MinIO no disponible" };
  } catch (error) {
    checks.storage = { status: "error", detail: String(error) };
  }

  const memory = process.memoryUsage();
  checks.memory = {
    status: "ok",
    detail: `RSS: ${Math.round(memory.rss / 1024 / 1024)}MB | Heap: ${Math.round(memory.heapUsed / 1024 / 1024)}MB / ${Math.round(memory.heapTotal / 1024 / 1024)}MB`,
  };
  checks.node = { status: "ok", detail: `Node ${process.version} — uptime ${Math.floor(process.uptime())}s` };

  const allOk = Object.values(checks).every((check) => check.status === "ok");
  return NextResponse.json({
    status: allOk ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
  });
}
