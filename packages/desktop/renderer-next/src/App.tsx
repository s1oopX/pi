import { useCallback, useEffect, useMemo, useState } from "react";
import { Layout } from "./components/Layout";
import {
  CommandPalette,
  COMMAND_PALETTE_ENTRIES,
  runAppCommand,
} from "./components/CommandPalette";
import { Composer } from "./components/Composer";
import { MessageList } from "./components/MessageList";
import { Settings } from "./components/Settings";
import { ToastContainer } from "./components/Toast";
import { TopBar } from "./components/TopBar";
import { WorkbenchPanel, type WorkbenchKeybindingLabels, type WorkbenchView } from "./components/Workbench";
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

export function App() {
  const { t } = useI18n();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [workbenchView, setWorkbenchView] = useState<WorkbenchView | "closed">("closed");
  const initialize = useStore((state) => state.initialize);
  const settingsRoute = useStore((state) => state.settingsRoute);
  const workspaceCwd = useStore((state) => state.workspaceCwd);
  const sessionId = useStore((state) => state.session?.sessionId ?? "no-session");
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

  const openWorkbench = useCallback((view: WorkbenchView) => {
    setWorkbenchView(view);
  }, []);

  const toggleWorkbench = useCallback(() => {
    setWorkbenchView((current) => current === "closed" ? "launcher" : "closed");
  }, []);

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
              <svg viewBox="0 0 18 18" aria-hidden="true">
                <rect x="3" y="3" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
                <path d="M7 3v12" fill="none" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </button>
            <button
              className="icon-button window-chrome-nav"
              type="button"
              aria-label={t("Back", "后退")}
              onClick={() => window.history.back()}
            >
              <svg viewBox="0 0 18 18" aria-hidden="true">
                <path d="M11 4 6 9l5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              className="icon-button window-chrome-nav"
              type="button"
              aria-label={t("Forward", "前进")}
              onClick={() => window.history.forward()}
            >
              <svg viewBox="0 0 18 18" aria-hidden="true">
                <path d="m7 4 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <nav className="window-chrome-menu" aria-label={t("Application menu", "应用菜单")}>
              <span>{t("File", "文件")}</span>
              <button type="button" onClick={() => handleAppCommand("open-command-palette")}>
                {t("Edit", "编辑")}
              </button>
              <button type="button" onClick={toggleWorkbench}>
                {t("View", "视图")}
              </button>
              <button type="button" onClick={() => useStore.getState().openSettings("about")}>
                {t("Help", "帮助")}
              </button>
            </nav>
          </div>
          <div className="window-chrome-drag" aria-hidden="true" />
        </div>
        <Layout
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
        >
          <TopBar
            commandPaletteShortcut={formatAppKeybinding(keybindings["open-command-palette"], platform)}
            workbenchOpen={workbenchView !== "closed"}
            workbenchShortcut={workbenchKeybindingLabels.toggle ?? ""}
            onOpenCommandPalette={() => handleAppCommand("open-command-palette")}
            onOpenWorkbench={openWorkbench}
            onToggleWorkbench={toggleWorkbench}
          />
          <div className={`main-workspace ${workbenchView !== "closed" ? "with-workbench" : ""}`}>
            <section className="conversation-pane" aria-label="Conversation">
              <MessageList />
              <Composer key={`${workspaceCwd || "no-workspace"}:${sessionId}`} />
            </section>
            {workbenchView !== "closed" && (
              <WorkbenchPanel
                activeView={workbenchView}
                keybindingLabels={workbenchKeybindingLabels}
                onClose={() => setWorkbenchView("closed")}
                onSelectView={openWorkbench}
              />
            )}
          </div>
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
