import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useI18n } from "../../i18n";
import type { WidthBounds } from "../../lib/panelSizing";
import { Sidebar } from "../Sidebar/Sidebar";

interface LayoutProps {
  children: ReactNode;
  sidebarCollapsed: boolean;
  sidebarWidth: number | null;
  sidebarBounds: WidthBounds;
  sidebarResizing: boolean;
  sidebarWillCollapse: boolean;
  onSidebarResizePointerDown: (event: PointerEvent) => void;
  onSidebarResizeKeyDown: (event: KeyboardEvent) => void;
  onToggleSidebar: () => void;
}

export function Layout({
  children,
  sidebarCollapsed,
  sidebarWidth,
  sidebarBounds,
  sidebarResizing,
  sidebarWillCollapse,
  onSidebarResizePointerDown,
  onSidebarResizeKeyDown,
  onToggleSidebar,
}: LayoutProps) {
  const { t } = useI18n();
  const style =
    sidebarCollapsed || sidebarWidth === null
      ? undefined
      : ({ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties);
  return (
    <div
      className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${sidebarResizing ? "resizing" : ""}`}
      style={style}
    >
      <Sidebar collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
      {!sidebarCollapsed && (
        <div
          className={`panel-resize-handle sidebar-resize ${sidebarWillCollapse ? "will-collapse" : ""}`}
          role="separator"
          tabIndex={0}
          aria-label={t("Resize sidebar", "调整侧边栏宽度")}
          aria-orientation="vertical"
          aria-valuemin={sidebarBounds.min}
          aria-valuemax={sidebarBounds.max}
          aria-valuenow={sidebarWidth ?? undefined}
          onPointerDown={onSidebarResizePointerDown}
          onKeyDown={onSidebarResizeKeyDown}
        />
      )}
      <main className="main-panel">{children}</main>
    </div>
  );
}
