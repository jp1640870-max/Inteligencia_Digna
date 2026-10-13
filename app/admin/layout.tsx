import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import AdminShell from "./AdminShell";
import { getAuthUserFromRequest } from "@/lib/auth";
import { canAccessAdminPanel } from "@/lib/permissions";

export const metadata = {
  title: "Panel de Administración — Inteligencia Digna",
  robots: "noindex, nofollow",
};

/**
 * Puerta del panel, en el servidor.
 *
 * Antes este layout solo envolvía al shell de cliente, y el shell decidía con un
 * `useEffect` si su usuario podía estar ahí. Eso deja el HTML de `/admin/*` al
 * alcance de cualquiera que abra la URL: los datos de cada pantalla ya estaban
 * protegidos por `requireCapability` en su ruta, pero el árbol de la página no,
 * y cualquier cosa que se renderice en el servidor dentro de estas rutas
 * saldría sin comprobar nada.
 *
 * El rol se resuelve contra la base de datos en cada petición, igual que en las
 * rutas de API, así que una degradación de rol surte efecto sin esperar a que
 * caduque la sesión.
 *
 * El `useEffect` de `AdminShell` se queda: cubre el caso en que el usuario
 * pierde la sesión estando ya dentro del panel. Es experiencia de usuario, no
 * control de acceso.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getAuthUserFromRequest();

  if (!user) {
    redirect("/login");
  }
  if (!canAccessAdminPanel(user.role)) {
    redirect("/");
  }

  return <AdminShell>{children}</AdminShell>;
}
