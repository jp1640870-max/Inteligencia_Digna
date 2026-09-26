import type { NextConfig } from "next";
import { networkInterfaces } from "os";

const REQUIRED = [
  "JWT_SECRET",
  "DATABASE_URL",
  "OLLAMA_URL",
  "OLLAMA_CHAT_MODEL",
  "OLLAMA_AGENT_MODEL",
  "OLLAMA_EMBEDDING_MODEL",
] as const;
const missing = REQUIRED.filter((key) => !process.env[key]);

if (missing.length > 0 && process.env.NODE_ENV !== "production") {
  console.warn(`Variables de entorno pendientes para runtime: ${missing.join(", ")}`);
}

const networkIPs = Object.values(networkInterfaces())
  .flat()
  .filter((iface) => iface?.family === "IPv4" && !iface.internal)
  .map((iface) => iface?.address)
  .filter(Boolean) as string[];

const nextConfig: NextConfig = {
  allowedDevOrigins: [...new Set(["localhost", ...networkIPs, "*.lvh.me", "*.ngrok-free.dev"])],
  devIndicators: false,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**.googleusercontent.com" }],
  },
};

export default nextConfig;
