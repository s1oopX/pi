import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import { useStore } from "../../store";
import { isSameWorkspace } from "../Sidebar/sidebarState";
import { showToast } from "../Toast";

interface TopBarProps {
  commandPaletteShortcut: string;
  workbenchOpen: boolean;
  workbenchShortcut: string;
  onOpenCommandPalette: () => void;
  onOpenWorkbench: (view: "files" | "terminal") => void;
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
  const [openingLocation, setOpeningLocation] = useState(false);
  const [locationMenuOpen, setLocationMenuOpen] = useState(false);
  const locationMenuRef = useRef<HTMLDivElement>(null);
  const locationMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const locationMenuInitialFocusRef = useRef<"first" | "last">("first");

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
          <span className="top-bar-divider" aria-hidden="true">·</span>
          <span className="top-bar-workspace" title={workspaceCwd}>{workspaceName}</span>
          {gitLabel && (
            <>
              <span className="top-bar-divider top-bar-git-divider" aria-hidden="true">·</span>
              <button
                className="top-bar-git"
                type="button"
                disabled={workspaceGitStatusLoading}
                onClick={refreshWorkspaceGitStatus}
                title={t(
                  "{branch} — {state}. Click to refresh.",
                  "{branch} — {state}。点击刷新。",
                  { branch: gitLabel, state: gitState },
                )}
                aria-label={t("Git branch {branch}, {state}", "Git 分支 {branch}，{state}", {
                  branch: gitLabel,
                  state: gitState,
                })}
              >
                <svg viewBox="0 0 18 18" aria-hidden="true">
                  <circle cx="5" cy="4" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  <circle cx="5" cy="14" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  <circle cx="13" cy="7" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M5 5.75v6.5M6.75 12.5c3.5-.4 6.25-1.9 6.25-3.75" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                <span>{gitLabel}</span>
                {workspaceGitStatus?.dirty && <span className="top-bar-git-dirty" aria-hidden="true" />}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="top-bar-right">
        <div className="top-bar-open-location-wrap" ref={locationMenuRef}>
          <button
            className="top-bar-open-location-main"
            type="button"
            disabled={openingLocation}
            aria-label={t("Open workspace location in File Explorer", "在文件资源管理器中打开工作区位置")}
            title={workspaceCwd ? t("Open {path}", "打开 {path}", { path: workspaceCwd }) : t("Open workspace location", "打开工作区位置")}
            onClick={handleOpenWorkspaceLocation}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
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
            <svg className="top-bar-open-location-chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m5 6 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
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
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
                <span>{t("File Explorer", "文件资源管理器")}</span>
              </button>
              <button type="button" role="menuitem" tabIndex={-1} onClick={() => handleOpenInWorkbench("files")}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 5h14v14H5zM9 5v14M9 9h10M9 13h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
                <span>{t("Workbench files", "工作台文件")}</span>
              </button>
              <button type="button" role="menuitem" tabIndex={-1} onClick={() => handleOpenInWorkbench("terminal")}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6 8 4 4-4 4M12 17h6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
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
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="m8 8-4 4 4 4M12 16h8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          className={`icon-button top-bar-workbench-toggle ${workbenchOpen ? "active" : ""}`}
          type="button"
          aria-label={t("Toggle workbench", "切换工作台")}
          aria-pressed={workbenchOpen}
          title={workbenchTitle}
          onClick={onToggleWorkbench}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="5" width="16" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M14 5v14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
