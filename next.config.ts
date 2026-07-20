import type { NextConfig } from "next";
import { networkInterfaces } from "os";

// ─── Validación rápida de entorno en startup ───
const REQUIRED = ["JWT_SECRET", "OLLAMA_URL", "TEXT_MODEL"] as const;
const missing = REQUIRED.filter((key) => !process.env[key]);

if (missing.length > 0 && process.env.NEXT_PHASE !== "phase-production-build") {
  console.error(`\n❌ Variables de entorno faltantes: ${missing.join(", ")}`);
  console.error("   Revisa tu archivo .env.local\n");
  process.exit(1);
}

const networkIPs = Object.values(networkInterfaces())
  .flat()
  .filter((iface) => iface?.family === "IPv4" && !iface.internal)
  .map((iface) => iface?.address)
  .filter(Boolean) as string[];

const nextConfig: NextConfig = {
  allowedDevOrigins: [...new Set(["localhost", ...networkIPs, "*.lvh.me", "*.ngrok-free.dev"])],
  devIndicators: false,
};

export default nextConfig;
