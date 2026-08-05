import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useI18n } from "../../i18n";
import { Icon } from "../Icon";
import * as api from "../../ipc/api";
import { useStore } from "../../store";
import { isActiveBackendReady } from "../../store/taskRegistry";
import { summarizeGitSync } from "../GitPanel/gitPanelState";
import { isSameWorkspace } from "../Sidebar/sidebarState";
import { showToast } from "../Toast";

interface TopBarProps {
  commandPaletteShortcut: string;
  workbenchOpen: boolean;
  workbenchShortcut: string;
  onOpenCommandPalette: () => void;
  onOpenWorkbench: (view: "git" | "files" | "terminal") => void;
  onToggleWorkbench: () => void;
}

export function TopBar({
  commandPaletteShortcut,
  workbenchOpen,
  workbenchShortcut,
  onOpenCommandPalette,
  onOpenWorkbench,
  onToggleWorkbench,
}: TopBarProps) {
  const { t } = useI18n();
  const session = useStore((s) => s.session);
  const sessions = useStore((s) => s.sessions);
  const workspaceCwd = useStore((s) => s.workspaceCwd);
  const taskCwd = useStore((s) => s.taskCwd);
  const workspaceGitStatus = useStore((s) => s.workspaceGitStatus);
  const workspaceGitStatusLoading = useStore((s) => s.workspaceGitStatusLoading);
  const refreshWorkspaceGitStatus = useStore((s) => s.refreshWorkspaceGitStatus);
  const isStreaming = useStore((s) => s.isStreaming);
  const activeBackendReady = useStore((s) => isActiveBackendReady(s.taskRegistry, s.backendStatus.ready));
  const [openingLocation, setOpeningLocation] = useState(false);
  const [locationMenuOpen, setLocationMenuOpen] = useState(false);
  const locationMenuRef = useRef<HTMLDivElement>(null);
  const locationMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const locationMenuInitialFocusRef = useRef<"first" | "last">("first");

  const gitSync = summarizeGitSync(workspaceGitStatus);

  const activeSession = sessions.find((candidate) => candidate.id === session?.sessionId);
  const threadTitle =
    session?.sessionName?.trim() ||
    activeSession?.name?.trim() ||
    activeSession?.firstMessage?.trim() ||
    t("New thread", "新会话");
  const workspaceName = taskCwd && isSameWorkspace(workspaceCwd, taskCwd)
    ? t("Tasks", "任务")
    : workspaceCwd.split(/[\\/]/).filter(Boolean).pop() || t("No workspace", "未选择工作区");
  const gitLabel = workspaceGitStatus?.kind === "repository"
    ? workspaceGitStatus.detached
      ? t("Detached HEAD", "游离 HEAD")
      : workspaceGitStatus.branch ?? t("Git repository", "Git 仓库")
    : null;
  const gitState = workspaceGitStatus?.dirty
    ? t("uncommitted changes", "有未提交的更改")
    : t("clean", "干净");
  const commandPaletteTitle = commandPaletteShortcut
    ? t("Open command palette ({shortcut})", "打开命令面板（{shortcut}）", { shortcut: commandPaletteShortcut })
    : t("Open command palette", "打开命令面板");
  const workbenchTitle = workbenchShortcut
    ? t("Toggle workbench ({shortcut})", "切换工作台（{shortcut}）", { shortcut: workbenchShortcut })
    : t("Toggle workbench", "切换工作台");

  async function handleOpenWorkspaceLocation() {
    setLocationMenuOpen(false);
    setOpeningLocation(true);
    try {
      await api.openWorkspaceLocation(workspaceCwd || undefined);
      showToast(t("Opened workspace location", "已打开工作区位置"), "success");
    } catch (error) {
      showToast(t("Failed to open location: {message}", "打开位置失败：{message}", {
        message: error instanceof Error && error.message.trim() ? error.message : String(error),
      }), "error");
    } finally {
      setOpeningLocation(false);
    }
  }

  function handleOpenInWorkbench(view: "files" | "terminal") {
    setLocationMenuOpen(false);
    onOpenWorkbench(view);
  }

  function closeLocationMenu(restoreFocus = false) {
    setLocationMenuOpen(false);
    if (restoreFocus) requestAnimationFrame(() => locationMenuTriggerRef.current?.focus());
  }

  function handleLocationMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeLocationMenu(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const items = Array.from(
      locationMenuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? [],
    );
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else if (event.key === "ArrowDown") {
      nextIndex = currentIndex < 0 || currentIndex === items.length - 1 ? 0 : currentIndex + 1;
    } else {
      nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    }
    items[nextIndex]?.focus();
  }

  useEffect(() => {
    const handleFocus = () => refreshWorkspaceGitStatus();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshWorkspaceGitStatus]);

  useEffect(() => {
    if (!locationMenuOpen) return;
    const focusFrame = requestAnimationFrame(() => {
      const items = locationMenuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)");
      if (!items || items.length === 0) return;
      items[locationMenuInitialFocusRef.current === "last" ? items.length - 1 : 0]?.focus();
    });
    function handlePointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;
      if (locationMenuRef.current?.contains(event.target)) return;
      setLocationMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeLocationMenu(true);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [locationMenuOpen]);

  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <div className="top-bar-context">
          <span className="top-bar-title" title={threadTitle}>{threadTitle}</span>
          <span className="top-bar-meta">
            <span className="top-bar-workspace" title={workspaceCwd}>{workspaceName}</span>
            {gitLabel && (
              <button
                className="top-bar-git"
                type="button"
                disabled={workspaceGitStatusLoading}
                onClick={() => onOpenWorkbench("git")}
                title={t(
                  "{branch} — {state}. Open Git tools in the workbench.",
                  "{branch} — {state}。在工作台中打开 Git 工具。",
                  { branch: gitLabel, state: gitState },
                )}
                aria-label={t("Git branch {branch}, {state}", "Git 分支 {branch}，{state}", {
                  branch: gitLabel,
                  state: gitState,
                })}
              >
                <Icon name="git-branch" size={16} />
                <span>{gitLabel}</span>
                {gitSync.show && (
                  <span className="top-bar-git-sync" aria-hidden="true">
                    {gitSync.ahead > 0 && <span className="top-bar-git-ahead">↑{gitSync.ahead}</span>}
                    {gitSync.behind > 0 && <span className="top-bar-git-behind">↓{gitSync.behind}</span>}
                  </span>
                )}
                {workspaceGitStatus?.dirty && <span className="top-bar-git-dirty" aria-hidden="true" />}
              </button>
            )}
          </span>
        </div>
      </div>

      <div className="top-bar-right">
        <span className={`top-bar-task-state ${isStreaming ? "running" : activeBackendReady ? "ready" : "attention"}`} role="status">
          <span aria-hidden="true" />
          {isStreaming
            ? t("Running", "运行中")
            : activeBackendReady
              ? t("Ready", "就绪")
              : t("Needs attention", "需要处理")}
        </span>
        <div className="top-bar-open-location-wrap" ref={locationMenuRef}>
          <button
            className="top-bar-open-location-main"
            type="button"
            disabled={openingLocation}
            aria-label={t("Open workspace location in File Explorer", "在文件资源管理器中打开工作区位置")}
            title={workspaceCwd ? t("Open {path}", "打开 {path}", { path: workspaceCwd }) : t("Open workspace location", "打开工作区位置")}
            onClick={handleOpenWorkspaceLocation}
          >
            <Icon name="folder" size={16} />
            <span className="top-bar-open-location-label">{t("Open location", "打开位置")}</span>
          </button>
          <button
            ref={locationMenuTriggerRef}
            className="top-bar-open-location-menu-button"
            type="button"
            disabled={openingLocation}
            aria-label={t("Choose how to open the workspace location", "选择工作区位置打开方式")}
            aria-haspopup="menu"
            aria-expanded={locationMenuOpen}
            title={t("Choose open method", "选择打开方式")}
            onClick={() => {
              if (locationMenuOpen) {
                closeLocationMenu();
                return;
              }
              locationMenuInitialFocusRef.current = "first";
              setLocationMenuOpen(true);
            }}
            onKeyDown={(event) => {
              if (locationMenuOpen || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
              event.preventDefault();
              locationMenuInitialFocusRef.current = event.key === "ArrowUp" ? "last" : "first";
              setLocationMenuOpen(true);
            }}
          >
            <Icon className="top-bar-open-location-chevron" name="chevron-down" size={16} />
          </button>
          {locationMenuOpen && (
            <div
              className="top-bar-open-location-menu"
              role="menu"
              onKeyDown={handleLocationMenuKeyDown}
              onBlur={(event) => {
                if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                closeLocationMenu();
              }}
            >
              <button type="button" role="menuitem" tabIndex={-1} onClick={handleOpenWorkspaceLocation}>
                <Icon name="folder" size={18} />
                <span>{t("File Explorer", "文件资源管理器")}</span>
              </button>
              <button type="button" role="menuitem" tabIndex={-1} onClick={() => handleOpenInWorkbench("files")}>
                <Icon name="grid" size={18} />
                <span>{t("Workbench files", "工作台文件")}</span>
              </button>
              <button type="button" role="menuitem" tabIndex={-1} onClick={() => handleOpenInWorkbench("terminal")}>
                <Icon name="terminal" size={18} />
                <span>{t("Workbench terminal", "工作台终端")}</span>
              </button>
            </div>
          )}
        </div>
        <button
          className="icon-button top-bar-command-palette"
          type="button"
          aria-label={t("Open command palette", "打开命令面板")}
          title={commandPaletteTitle}
          onClick={onOpenCommandPalette}
        >
          <Icon name="command" size={16} />
        </button>
        <button
          className={`icon-button top-bar-workbench-toggle ${workbenchOpen ? "active" : ""}`}
          type="button"
          aria-label={t("Toggle workbench", "切换工作台")}
          aria-pressed={workbenchOpen}
          title={workbenchTitle}
          onClick={onToggleWorkbench}
        >
          <Icon name="panel-right" size={16} />
        </button>
      </div>
    </div>
  );
}
