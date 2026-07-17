import type { ReactNode } from "react";
import { Sidebar } from "../Sidebar/Sidebar";

interface LayoutProps {
  children: ReactNode;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function Layout({ children, sidebarCollapsed, onToggleSidebar }: LayoutProps) {
  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={onToggleSidebar}
      />
      <main className="main-panel">
        {children}
      </main>
    </div>
  );
}
