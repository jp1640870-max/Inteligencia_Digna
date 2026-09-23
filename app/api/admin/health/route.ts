import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";

export async function GET() {
  const { allowed } = await requireRole(["super_admin", "admin", "editor", "viewer"]);
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const checks: Record<string, { status: "ok" | "error"; detail?: string; latency?: number }> = {};

  // 1. Database
  try {
    const { getSystemStats } = await import("@/lib/db");
    const start = Date.now();
    getSystemStats();
    checks.database = { status: "ok", latency: Date.now() - start };
  } catch (e) {
    checks.database = { status: "error", detail: String(e) };
  }

  // 2. SGLang (motores OpenAI-compatibles: chat, hearts, embeddings)
  try {
    const { env } = await import("@/lib/env");
    const start = Date.now();
    const base = String(env.SGLANG_URL).replace(/\/+$/, "").replace(/\/v1$/, "");
    const res = await fetch(`${base}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data: { data?: Array<{ id?: string }> } = await res.json();
      const models = (data.data || []).map((m) => m.id || "").filter(Boolean);
      checks.sglang = {
        status: "ok",
        latency: Date.now() - start,
        detail: models.join(", "),
      };
    } else {
      checks.sglang = { status: "error", detail: `HTTP ${res.status}` };
    }
  } catch (e) {
    checks.sglang = { status: "error", detail: String(e) };
  }

  // 3. System memory (solo server-side粗略)
  try {
    const mem = process.memoryUsage();
    checks.memory = {
      status: "ok",
      detail: `RSS: ${Math.round(mem.rss / 1024 / 1024)}MB | Heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
    };
  } catch (e) {
    checks.memory = { status: "error", detail: String(e) };
  }

  // 4. Uptime / Node
  checks.node = {
    status: "ok",
    detail: `Node ${process.version} — uptime ${Math.floor(process.uptime())}s`,
  };

  const allOk = Object.values(checks).every((c) => c.status === "ok");

  return NextResponse.json({
    status: allOk ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
  });
}
