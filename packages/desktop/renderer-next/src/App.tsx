import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelResize } from "./hooks/usePanelResize";
import { getSidebarBoundsForViewport, getWorkbenchBoundsForViewport } from "./lib/panelSizing";
import { Layout } from "./components/Layout";
import { Automations } from "./components/Automations";
import {
  CommandPalette,
  COMMAND_PALETTE_ENTRIES,
  runAppCommand,
} from "./components/CommandPalette";
import { Composer } from "./components/Composer";
import { Icon } from "./components/Icon";
import { MessageList } from "./components/MessageList";
import { Settings } from "./components/Settings";
import { ToastContainer } from "./components/Toast";
import { TopBar } from "./components/TopBar";
import { TrustBanner } from "./components/TrustBanner";
import { WorkbenchPanel, type WorkbenchKeybindingLabels, type WorkbenchView } from "./components/Workbench";
import { subscribeTaskReview } from "./components/Workbench/taskReviewNavigation";
import { useI18n } from "./i18n";
import { useBackendEvents } from "./ipc/events";
import {
  formatAppKeybinding,
  getAppPlatform,
  type AppCommandId,
} from "./keybindings/appKeybindings";
import { useAppKeybindings } from "./keybindings/useAppKeybindings";
import { useAppShortcuts } from "./keybindings/useAppShortcuts";
import { useStore } from "./store";

const DEFAULT_VIEWPORT_WIDTH = 1200;
const SIDEBAR_COLLAPSED_WIDTH = 52;
const NARROW_VIEWPORT_WIDTH = 480;

export function App() {
  const { t } = useI18n();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    typeof window !== "undefined" && window.innerWidth <= NARROW_VIEWPORT_WIDTH
  );
  const [workbenchView, setWorkbenchView] = useState<WorkbenchView | "closed">("closed");
  const workbenchReturnFocusRef = useRef<HTMLElement | null>(null);
  const workbenchWasOpenRef = useRef(false);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? DEFAULT_VIEWPORT_WIDTH : window.innerWidth
  );

  const collapseSidebar = useCallback(() => setSidebarCollapsed(true), []);
  const closeWorkbench = useCallback(() => setWorkbenchView("closed"), []);
  const openAutomations = useCallback(() => {
    setWorkbenchView("closed");
    setCommandPaletteOpen(false);
    setAutomationsOpen(true);
  }, []);
  const sidebarBounds = useMemo(() => getSidebarBoundsForViewport(viewportWidth), [viewportWidth]);
  const sidebarResize = usePanelResize({
    storageKey: "sidebar",
    defaultWidth: 250,
    bounds: sidebarBounds,
    collapseAt: 180,
    edge: "right",
    collapsed: sidebarCollapsed,
    onCollapse: collapseSidebar,
  });
  const workbenchBounds = useMemo(() =>
    getWorkbenchBoundsForViewport(
      viewportWidth,
      sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarResize.width ?? sidebarBounds.min,
    ), [sidebarBounds.min, sidebarCollapsed, sidebarResize.width, viewportWidth]);
  const workbenchResize = usePanelResize({
    storageKey: "workbench",
    defaultWidth: 460,
    bounds: workbenchBounds,
    collapseAt: 300,
    edge: "left",
    collapsed: workbenchView === "closed",
    onCollapse: closeWorkbench,
  });
  const initialize = useStore((state) => state.initialize);
  const settingsRoute = useStore((state) => state.settingsRoute);
  const backendReady = useStore((state) => state.backendStatus.ready);
  const isStreaming = useStore((state) => state.isStreaming);
  const { keybindings } = useAppKeybindings();
  const platform = useMemo(() => getAppPlatform(), []);
  const commandEntries = useMemo(
    () => COMMAND_PALETTE_ENTRIES.map((entry) => {
      if (entry.id !== "new-thread") return entry;
      if (!backendReady) return { ...entry, disabled: true, disabledReason: "Agent backend is not ready" };
      if (isStreaming) return { ...entry, disabled: true, disabledReason: "Finish or stop the current run first" };
      return entry;
    }),
    [backendReady, isStreaming],
  );
  const workbenchKeybindingLabels = useMemo<WorkbenchKeybindingLabels>(() => ({
    toggle: formatAppKeybinding(keybindings["toggle-workbench"], platform),
    review: formatAppKeybinding(keybindings["open-workbench-review"], platform),
    terminal: formatAppKeybinding(keybindings["open-workbench-terminal"], platform),
    browser: formatAppKeybinding(keybindings["open-workbench-browser"], platform),
    files: formatAppKeybinding(keybindings["open-workbench-files"], platform),
    "side-task": formatAppKeybinding(keybindings["open-workbench-side-task"], platform),
  }), [keybindings, platform]);

  useBackendEvents();

  const rememberWorkbenchReturnFocus = useCallback(() => {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) return;
    if (activeElement.closest(".workbench-panel, .workbench-resize")) return;
    workbenchReturnFocusRef.current = activeElement;
  }, []);

  const openWorkbench = useCallback((view: WorkbenchView) => {
    rememberWorkbenchReturnFocus();
    setWorkbenchView(view);
  }, [rememberWorkbenchReturnFocus]);

  useEffect(() => subscribeTaskReview(() => {
    setAutomationsOpen(false);
    setCommandPaletteOpen(false);
    openWorkbench("review");
  }), [openWorkbench]);

  const toggleWorkbench = useCallback(() => {
    rememberWorkbenchReturnFocus();
    setWorkbenchView((current) => current === "closed" ? "launcher" : "closed");
  }, [rememberWorkbenchReturnFocus]);

  const handleAppCommand = useCallback((commandId: AppCommandId) => {
    if (commandId === "open-command-palette") {
      setCommandPaletteOpen((open) => !open);
      return;
    }
    if (commandId === "toggle-workbench") {
      toggleWorkbench();
      setCommandPaletteOpen(false);
      return;
    }
    if (commandId === "open-workbench-review") {
      openWorkbench("review");
      setCommandPaletteOpen(false);
      return;
    }
    if (commandId === "open-workbench-terminal") {
      openWorkbench("terminal");
      setCommandPaletteOpen(false);
      return;
    }
    if (commandId === "open-workbench-browser") {
      openWorkbench("browser");
      setCommandPaletteOpen(false);
      return;
    }
    if (commandId === "open-workbench-files") {
      openWorkbench("files");
      setCommandPaletteOpen(false);
      return;
    }
    if (commandId === "open-workbench-side-task") {
      openWorkbench("side-task");
      setCommandPaletteOpen(false);
      return;
    }
    setCommandPaletteOpen(false);
    runAppCommand(commandId);
  }, [openWorkbench, toggleWorkbench]);

  useAppShortcuts(keybindings, platform, handleAppCommand);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
      if (window.innerWidth <= NARROW_VIEWPORT_WIDTH) setSidebarCollapsed(true);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const workbenchOpen = workbenchView !== "closed";
    if (!workbenchOpen && workbenchWasOpenRef.current) {
      const returnFocus = workbenchReturnFocusRef.current;
      workbenchReturnFocusRef.current = null;
      const focusFrame = requestAnimationFrame(() => {
        if (document.activeElement !== document.body) return;
        if (returnFocus?.isConnected) {
          returnFocus.focus();
          return;
        }
        document.querySelector<HTMLElement>(".composer-input")?.focus();
      });
      workbenchWasOpenRef.current = false;
      return () => cancelAnimationFrame(focusFrame);
    }
    workbenchWasOpenRef.current = workbenchOpen;
  }, [workbenchView]);

  return (
    <>
      <div className="app-frame">
        <div className="window-chrome">
          <div className="window-chrome-left">
            <button
              className="icon-button window-chrome-sidebar-toggle"
              type="button"
              aria-label={sidebarCollapsed ? t("Expand sidebar", "展开侧边栏") : t("Collapse sidebar", "收起侧边栏")}
              aria-pressed={sidebarCollapsed}
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            >
              <Icon name="panel-left" size={18} />
            </button>
            <nav className="window-chrome-menu" aria-label={t("Application menu", "应用菜单")}>
              <button type="button" onClick={() => handleAppCommand("open-command-palette")}>
                {t("Commands", "命令")}
              </button>
              <button type="button" onClick={toggleWorkbench}>
                {t("Workbench", "工作台")}
              </button>
              <button type="button" onClick={() => useStore.getState().openSettings("about")}>
                {t("About", "关于")}
              </button>
            </nav>
          </div>
          <div className="window-chrome-drag" aria-hidden="true" />
        </div>
        <Layout
          sidebarCollapsed={sidebarCollapsed}
          sidebarWidth={sidebarResize.width}
          sidebarBounds={sidebarBounds}
          sidebarResizing={sidebarResize.dragging}
          sidebarWillCollapse={sidebarResize.willCollapse}
          onSidebarResizePointerDown={sidebarResize.onHandlePointerDown}
          onSidebarResizeKeyDown={sidebarResize.onHandleKeyDown}
          onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
          automationsOpen={automationsOpen}
          onOpenAutomations={openAutomations}
          onOpenConversation={() => setAutomationsOpen(false)}
        >
          {automationsOpen ? (
            <Automations onClose={() => setAutomationsOpen(false)} />
          ) : (
            <>
              <TopBar
                commandPaletteShortcut={formatAppKeybinding(keybindings["open-command-palette"], platform)}
                workbenchOpen={workbenchView !== "closed"}
                workbenchShortcut={workbenchKeybindingLabels.toggle ?? ""}
                onOpenCommandPalette={() => handleAppCommand("open-command-palette")}
                onOpenWorkbench={openWorkbench}
                onToggleWorkbench={toggleWorkbench}
              />
              <div
                className={`main-workspace ${workbenchView !== "closed" ? "with-workbench" : ""} ${workbenchResize.dragging ? "resizing" : ""}`}
                style={
                  workbenchView !== "closed" && workbenchResize.width !== null
                    ? ({ "--workbench-width": `${workbenchResize.width}px` } as CSSProperties)
                    : undefined
                }
              >
                <section className="conversation-pane" aria-label={t("Conversation", "对话")}>
                  <TrustBanner />
                  <MessageList />
                  <Composer />
                </section>
                {workbenchView !== "closed" && (
                    <div
                      className={`panel-resize-handle workbench-resize ${workbenchResize.willCollapse ? "will-collapse" : ""}`}
                      role="separator"
                      tabIndex={0}
                      aria-label={t("Resize workbench", "调整工作台宽度")}
                      aria-orientation="vertical"
                      aria-valuemin={workbenchBounds.min}
                      aria-valuemax={workbenchBounds.max}
                      aria-valuenow={workbenchResize.width ?? undefined}
                      onPointerDown={workbenchResize.onHandlePointerDown}
                      onKeyDown={workbenchResize.onHandleKeyDown}
                    />
                )}
                <WorkbenchPanel
                  activeView={workbenchView === "closed" ? "launcher" : workbenchView}
                  hidden={workbenchView === "closed"}
                  keybindingLabels={workbenchKeybindingLabels}
                  onClose={() => setWorkbenchView("closed")}
                  onSelectView={openWorkbench}
                />
              </div>
            </>
          )}
        </Layout>
      </div>
      {settingsRoute && <Settings />}
      {commandPaletteOpen && (
        <CommandPalette
          entries={commandEntries}
          keybindings={keybindings}
          platform={platform}
          onClose={() => setCommandPaletteOpen(false)}
          onRun={handleAppCommand}
        />
      )}
      <ToastContainer />
    </>
  );
}
