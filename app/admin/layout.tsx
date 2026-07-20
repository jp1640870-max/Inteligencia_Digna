import type { ReactNode } from "react";
import AdminShell from "./AdminShell";

export const metadata = {
  title: "Panel de Administración — Inteligencia Digna",
  robots: "noindex, nofollow",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
