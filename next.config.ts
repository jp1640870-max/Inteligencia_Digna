import type { NextConfig } from "next";
import { networkInterfaces } from "os";

const networkIPs = Object.values(networkInterfaces())
  .flat()
  .filter((iface) => iface?.family === "IPv4" && !iface.internal)
  .map((iface) => iface?.address)
  .filter(Boolean) as string[];

const nextConfig: NextConfig = {
  allowedDevOrigins: [...new Set(["localhost", ...networkIPs, "*.lvh.me", "*.ngrok-free.dev"])],
};

export default nextConfig;
