"use client";

import { PanelLeft } from "lucide-react";
import { useUIStore } from "@/lib/stores/ui-store";

export default function ViewSwitcher() {
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed);

  const isChat = view.type === "chat";
  const isProjects = view.type === "projects" || view.type === "project";

  const goToChat = () => {
    setView({ type: "chat" });
    setSidebarOpen(false);
  };

  const goToProjects = () => {
    setView({ type: "projects" });
    setSidebarOpen(false);
  };

  const openSidebar = () => {
    setSidebarCollapsed(false);
    setSidebarOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={openSidebar}
        className="mobile-panel-trigger lg:hidden"
        title="Abrir menú"
        aria-label="Abrir menú"
      >
        <PanelLeft size={17} strokeWidth={1.7} />
      </button>

      <nav className="view-switcher" aria-label="Vistas principales">
        <button
          type="button"
          onClick={goToChat}
          className={`view-switcher-tab ${isChat ? "active" : ""}`}
          aria-current={isChat ? "page" : undefined}
        >
          Chat
        </button>

        <button
          type="button"
          onClick={goToProjects}
          className={`view-switcher-tab ${isProjects ? "active" : ""}`}
          aria-current={isProjects ? "page" : undefined}
        >
          Proyectos
        </button>
      </nav>
    </>
  );
}
