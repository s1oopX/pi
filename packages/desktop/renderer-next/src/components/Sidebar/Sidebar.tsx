import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import type { SessionInfo } from "../../ipc/types";
import { useStore } from "../../store";
import { BrandIcon } from "../BrandIcon";
import { Icon } from "../Icon";
import { BranchNavigator } from "../BranchNavigator";
import { Dialog } from "../Dialog";
import { showToast } from "../Toast";
import {
  addWorkspace,
  clearOtherWorkspaces,
  getProjectNavigationItems,
  getWorkspaceDisplayParts,
  getWorkspaceName,
  groupSessionsByOwnership,
  isSameWorkspace,
  loadWorkspaces,
  removeWorkspace,
  saveWorkspaces,
} from "./sidebarState";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

interface SessionMenuState {
  session: SessionInfo;
  left: number;
  top: number;
}

interface WorkspaceMenuState {
  left: number;
  top: number;
}

interface FailedSwitchState {
  path: string;
  error: string;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { t } = useI18n();
  const sessions = useStore((state) => state.sessions);
  const sessionsHasMore = useStore((state) => state.sessionsHasMore);
  const sessionsQuery = useStore((state) => state.sessionsQuery);
  const sessionsLoading = useStore((state) => state.sessionsLoading);
  const sessionsError = useStore((state) => state.sessionsError);
  const session = useStore((state) => state.session);
  const isStreaming = useStore((state) => state.isStreaming);
  const workspaceCwd = useStore((state) => state.workspaceCwd);
  const taskCwd = useStore((state) => state.taskCwd);
  const backendStatus = useStore((state) => state.backendStatus);
  const openSettings = useStore((state) => state.openSettings);
  const searchSessions = useStore((state) => state.setSessionsQuery);
  const refreshSessions = useStore((state) => state.refreshSessions);
  const loadMoreSessions = useStore((state) => state.loadMoreSessions);

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [exporting, setExporting] = useState(false);
  const [creatingThread, setCreatingThread] = useState(false);
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState | null>(null);
  const [workspaceMenu, setWorkspaceMenu] = useState<WorkspaceMenuState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SessionInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [failedSwitch, setFailedSwitch] = useState<FailedSwitchState | null>(null);
  const [branchNavigatorOpen, setBranchNavigatorOpen] = useState(false);
  const [switchingWorkspaceCwd, setSwitchingWorkspaceCwd] = useState<string | null>(null);
  const [sessionQuery, setSessionQuery] = useState("");
  const [workspaces, setWorkspaces] = useState<string[]>(() => loadWorkspaces(localStorage));
  const [expandedProjects, setExpandedProjects] = useState<string[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const workspaceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const creatingThreadRef = useRef(false);

  const activeSessionId = session?.sessionId;
  const switchingWorkspace = switchingWorkspaceCwd !== null;
  const normalizedSessionQuery = sessionQuery.trim();
  const sessionSearchPending = normalizedSessionQuery !== sessionsQuery;
  const isTaskContext = Boolean(taskCwd && isSameWorkspace(workspaceCwd, taskCwd));
  const workspaceName = isTaskContext
    ? t("Tasks", "任务")
    : workspaceCwd
      ? getWorkspaceName(workspaceCwd)
      : t("No workspace", "未选择工作区");
  const sessionOwnership = useMemo(() => groupSessionsByOwnership(sessions, taskCwd), [sessions, taskCwd]);
  const workspaceNavigationItems = useMemo(
    () => getProjectNavigationItems(workspaces, workspaceCwd, taskCwd),
    [taskCwd, workspaceCwd, workspaces],
  );
  const otherWorkspaces = workspaceNavigationItems.filter((cwd) => !isSameWorkspace(cwd, workspaceCwd));
  const taskSessions = sessionOwnership.tasks;
  const backendStatusText = backendStatus.ready
    ? t("Ready", "就绪")
    : backendStatus.restarting
      ? t("Restarting...", "正在重启...")
      : backendStatus.starting
        ? t("Starting...", "正在启动...")
        : backendStatus.retryInMs > 0
          ? t("Retrying in {seconds}s", "{seconds} 秒后重试", {
              seconds: Math.max(1, Math.ceil(backendStatus.retryInMs / 1000)),
            })
          : t("Offline", "离线");
  const switchingWorkspaceName = switchingWorkspaceCwd ? getWorkspaceName(switchingWorkspaceCwd) : workspaceName;
  // Phase narrative while workspace switch restarts the backend process.
  const switchPhaseLabel = (() => {
    if (!switchingWorkspaceCwd) return null;
    if (backendStatus.restarting && !backendStatus.ready && !backendStatus.starting) {
      return t("Stopping current agent…", "正在关闭当前智能体…");
    }
    if (backendStatus.starting || backendStatus.restarting) {
      return t("Starting agent in {workspace}…", "正在启动 {workspace}…", {
        workspace: switchingWorkspaceName,
      });
    }
    if (
      backendStatus.ready &&
      (
        !isSameWorkspace(workspaceCwd, switchingWorkspaceCwd) ||
        !isSameWorkspace(backendStatus.cwd, switchingWorkspaceCwd)
      )
    ) {
      return t("Restoring session in {workspace}…", "正在恢复 {workspace} 会话…", {
        workspace: switchingWorkspaceName,
      });
    }
    return t("Opening {workspace}…", "正在打开 {workspace}…", {
      workspace: switchingWorkspaceName,
    });
  })();
  const workspaceStatusText = switchingWorkspace ? switchPhaseLabel : backendStatusText;
  const sessionLoadingText = switchingWorkspace
    ? switchPhaseLabel ?? t("Opening {workspace}…", "正在打开 {workspace}…", {
        workspace: switchingWorkspaceName,
      })
    : backendStatus.starting || backendStatus.restarting
      ? t("Preparing workspace…", "正在准备工作区…")
      : normalizedSessionQuery
        ? t("Searching...", "正在搜索...")
        : t("Loading...", "正在加载...");

  useEffect(() => {
    if (!sessionMenu) return;
    const focusFrame = requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")?.focus();
    });
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (menuRef.current?.contains(event.target) || menuTriggerRef.current?.contains(event.target)) return;
      setSessionMenu(null);
    };
    const handleWindowChange = () => setSessionMenu(null);
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [sessionMenu]);

  useEffect(() => {
    if (!workspaceCwd || isTaskContext) return;
    setWorkspaces((current) => {
      const next = addWorkspace(current, workspaceCwd);
      saveWorkspaces(localStorage, next);
      return next;
    });
  }, [isTaskContext, workspaceCwd]);

  useEffect(() => {
    if (!workspaceCwd || isTaskContext) return;
    setExpandedProjects((current) =>
      current.some((cwd) => isSameWorkspace(cwd, workspaceCwd)) ? current : [...current, workspaceCwd]
    );
  }, [isTaskContext, workspaceCwd]);

  useEffect(() => {
    setSessionQuery("");
  }, [workspaceCwd]);

  useEffect(() => {
    if (!switchingWorkspaceCwd) return;
    if (
      isSameWorkspace(workspaceCwd, switchingWorkspaceCwd) &&
      backendStatus.ready &&
      isSameWorkspace(backendStatus.cwd, switchingWorkspaceCwd)
    ) {
      setSwitchingWorkspaceCwd(null);
      return;
    }
    if (!backendStatus.ready && !backendStatus.starting && !backendStatus.restarting && backendStatus.retryInMs <= 0) {
      setSwitchingWorkspaceCwd(null);
    }
  }, [
    backendStatus.cwd,
    backendStatus.ready,
    backendStatus.restarting,
    backendStatus.retryInMs,
    backendStatus.starting,
    switchingWorkspaceCwd,
    workspaceCwd,
  ]);

  useEffect(() => {
    if (!sessionSearchPending) return;
    const timeout = window.setTimeout(() => {
      void searchSessions(normalizedSessionQuery);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [normalizedSessionQuery, searchSessions, sessionSearchPending]);

  useEffect(() => {
    if (!workspaceMenu) return;
    const focusFrame = requestAnimationFrame(() => {
      workspaceMenuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")?.focus();
    });
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (workspaceMenuRef.current?.contains(event.target) || workspaceTriggerRef.current?.contains(event.target)) return;
      setWorkspaceMenu(null);
    };
    const handleWindowChange = () => setWorkspaceMenu(null);
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [workspaceMenu]);

  function beginRename(candidate: SessionInfo) {
    setRenameValue(candidate.name ?? session?.sessionName ?? "");
    setRenaming(true);
  }

  async function commitRename() {
    const name = renameValue.trim();
    setRenaming(false);
    if (name && name !== session?.sessionName) {
      try {
        await api.setSessionName(name);
        await refreshSessions();
        useStore.getState().refreshSession();
      } catch (error) {
        showToast(
          t("Failed to rename thread: {error}", "重命名会话失败：{error}", {
            error: error instanceof Error ? error.message : String(error),
          }),
          "error",
        );
      }
    }
  }

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      await api.exportHtml();
    } catch (error) {
      showToast(
        t("Failed to export thread: {error}", "导出会话失败：{error}", {
          error: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
    } finally {
      setExporting(false);
    }
  }

  async function handleNewThread(targetCwd: string) {
    if (creatingThreadRef.current) return;
    if (useStore.getState().isStreaming) {
      showToast(t("Finish or stop the current run before creating a new thread.", "请先完成或停止当前运行，再新建会话。"), "warning");
      return;
    }
    if (!targetCwd) {
      showToast(t("Choose a project first.", "请先选择项目。"), "warning");
      return;
    }
    creatingThreadRef.current = true;
    setCreatingThread(true);
    try {
      const result = await api.newSession(targetCwd);
      if (result.cancelled) return;
      await useStore.getState().resetForWorkspace(result.cwd);
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus());
    } catch (error) {
      showToast(
        t("Failed to create thread: {error}", "新建会话失败：{error}", {
          error: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
    } finally {
      creatingThreadRef.current = false;
      setCreatingThread(false);
    }
  }

  function handleNewTask() {
    void handleNewThread(taskCwd);
  }

  function handleNewProjectThread(cwd: string) {
    retainWorkspace(cwd);
    setExpandedProjects((current) =>
      current.some((candidate) => isSameWorkspace(candidate, cwd)) ? current : [...current, cwd]
    );
    void handleNewThread(cwd);
  }

  async function handleRestartBackend() {
    try {
      await api.restartBackend();
    } catch (error) {
      showToast(
        t("Failed to restart backend: {error}", "重启后端失败：{error}", {
          error: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
    }
  }

  async function handleSwitchThread(sessionPath: string) {
    const state = useStore.getState();
    const target = state.sessions.find((candidate) => candidate.path === sessionPath);
    if (target?.id === state.session?.sessionId) return;
    if (state.session?.sessionFile === sessionPath) return;
    if (state.isStreaming) {
      showToast(t("Finish or stop the current run before switching threads.", "请先完成或停止当前运行，再切换会话。"), "warning");
      return;
    }
    setFailedSwitch(null);
    try {
      const result = await api.switchSession(sessionPath);
      if (result.cancelled) return;
      useStore.getState().resetForWorkspace(result.cwd);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFailedSwitch({ path: sessionPath, error: message });
      showToast(
        t("Failed to open thread: {error}", "打开会话失败：{error}", {
          error: message,
        }),
        "error",
      );
    }
  }

  function openSessionMenu(event: MouseEvent<HTMLButtonElement>, candidate: SessionInfo) {
    if (sessionMenu?.session.path === candidate.path) {
      setSessionMenu(null);
      return;
    }
    const triggerBounds = event.currentTarget.getBoundingClientRect();
    const menuWidth = 196;
    const estimatedMenuHeight = candidate.id === activeSessionId ? 210 : 86;
    const left = Math.max(8, Math.min(triggerBounds.right - menuWidth, window.innerWidth - menuWidth - 8));
    const top =
      window.innerHeight - triggerBounds.bottom >= estimatedMenuHeight + 8
        ? triggerBounds.bottom + 4
        : Math.max(8, triggerBounds.top - estimatedMenuHeight - 4);
    menuTriggerRef.current = event.currentTarget;
    setWorkspaceMenu(null);
    setSessionMenu({ session: candidate, left, top });
  }

  function closeSessionMenu(restoreFocus = false) {
    setSessionMenu(null);
    if (restoreFocus) requestAnimationFrame(() => menuTriggerRef.current?.focus());
  }

  function handleSessionMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSessionMenu(true);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      closeSessionMenu(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? []);
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else if (event.key === "ArrowDown") nextIndex = (currentIndex + 1 + items.length) % items.length;
    else nextIndex = (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  async function handleRevealSession(candidate: SessionInfo) {
    closeSessionMenu(true);
    try {
      await api.revealSessionFile(candidate.path);
    } catch (error) {
      showToast(
        t("Failed to reveal thread: {error}", "在文件管理器中显示会话失败：{error}", {
          error: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
    }
  }

  async function handleCloneSession() {
    if (cloning) return;
    if (useStore.getState().isStreaming) {
      showToast(t("Finish or stop the current run before cloning this thread.", "请先完成或停止当前运行，再克隆此会话。"), "warning");
      return;
    }
    closeSessionMenu();
    setCloning(true);
    try {
      const result = await api.cloneSession();
      if (result.cancelled) return;
      useStore.getState().resetForWorkspace(useStore.getState().workspaceCwd);
      showToast(t("Thread cloned", "会话已克隆"), "success");
    } catch (error) {
      showToast(
        t("Failed to clone thread: {error}", "克隆会话失败：{error}", {
          error: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
    } finally {
      setCloning(false);
    }
  }

  async function handleDeleteSession() {
    if (!deleteTarget || deleting) return;
    const target = deleteTarget;
    if (useStore.getState().session?.sessionId === target.id) return;

    setDeleting(true);
    try {
      await api.trashSessionFile(target.path);
      await refreshSessions();
      useStore.getState().refreshSession();
      setDeleteTarget(null);
      showToast(t("Thread moved to the Recycle Bin", "会话已移至回收站"), "success");
    } catch (error) {
      showToast(
        t("Failed to delete thread: {error}", "删除会话失败：{error}", {
          error: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  function retainWorkspace(cwd: string) {
    setWorkspaces((current) => {
      const next = addWorkspace(current, cwd);
      saveWorkspaces(localStorage, next);
      return next;
    });
  }

  async function handleOpenWorkspace(cwd: string) {
    if (switchingWorkspace || !cwd.trim()) return;
    if (useStore.getState().isStreaming) {
      showToast(t("Finish or stop the current run before switching workspaces.", "请先完成或停止当前运行，再切换工作区。"), "warning");
      return;
    }
    setWorkspaceMenu(null);
    if (isSameWorkspace(cwd, workspaceCwd)) {
      if (!taskCwd || !isSameWorkspace(cwd, taskCwd)) retainWorkspace(workspaceCwd);
      return;
    }

    setSwitchingWorkspaceCwd(cwd);
    try {
      const result = await api.openWorkspace(cwd);
      if (!taskCwd || !isSameWorkspace(result.cwd, taskCwd)) retainWorkspace(result.cwd);
      if (result.changed) {
        setSwitchingWorkspaceCwd(result.cwd);
        useStore.getState().resetForWorkspace(result.cwd);
      } else {
        setSwitchingWorkspaceCwd(null);
      }
    } catch (error) {
      setSwitchingWorkspaceCwd(null);
      showToast(
        t("Failed to open workspace: {error}", "打开工作区失败：{error}", {
          error: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
    }
  }

  async function handleChooseWorkspace() {
    if (switchingWorkspace) return;
    if (useStore.getState().isStreaming) {
      showToast(t("Finish or stop the current run before adding a workspace.", "请先完成或停止当前运行，再添加工作区。"), "warning");
      return;
    }
    setWorkspaceMenu(null);
    try {
      const selection = await api.chooseWorkspace();
      if (!selection.changed) {
        retainWorkspace(selection.cwd);
        return;
      }
      await handleOpenWorkspace(selection.cwd);
    } catch (error) {
      showToast(
        t("Failed to choose workspace: {error}", "选择工作区失败：{error}", {
          error: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
    }
  }

  function openWorkspaceMenu(event: MouseEvent<HTMLButtonElement>) {
    if (workspaceMenu) {
      setWorkspaceMenu(null);
      return;
    }
    const triggerBounds = event.currentTarget.getBoundingClientRect();
    const menuWidth = 300;
    const estimatedMenuHeight = Math.min(480, 196 + Math.max(1, otherWorkspaces.length) * 48);
    const left = Math.max(8, Math.min(triggerBounds.left, window.innerWidth - menuWidth - 8));
    const top = Math.max(8, Math.min(triggerBounds.bottom + 4, triggerBounds.top - estimatedMenuHeight - 4));
    workspaceTriggerRef.current = event.currentTarget;
    setSessionMenu(null);
    setWorkspaceMenu({ left, top });
  }

  function closeWorkspaceMenu(restoreFocus = false) {
    setWorkspaceMenu(null);
    if (restoreFocus) requestAnimationFrame(() => workspaceTriggerRef.current?.focus());
  }

  function handleWorkspaceMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeWorkspaceMenu(true);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      closeWorkspaceMenu(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(
      workspaceMenuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? [],
    );
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else if (event.key === "ArrowDown") nextIndex = (currentIndex + 1 + items.length) % items.length;
    else nextIndex = (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  function handleRemoveWorkspace(cwd: string) {
    if (isSameWorkspace(cwd, workspaceCwd)) return;
    setWorkspaces((current) => {
      const next = removeWorkspace(current, cwd);
      saveWorkspaces(localStorage, next);
      return next;
    });
  }

  function handleClearOtherWorkspaces() {
    setWorkspaces((current) => {
      const next = clearOtherWorkspaces(current, workspaceCwd);
      saveWorkspaces(localStorage, next);
      return next;
    });
    closeWorkspaceMenu(true);
  }

  const deletingActiveSession = deleteTarget?.id === activeSessionId;

  function closeDeleteDialog() {
    setDeleteTarget(null);
    requestAnimationFrame(() => menuTriggerRef.current?.focus());
  }

  function toggleProject(cwd: string) {
    setExpandedProjects((current) =>
      current.some((candidate) => isSameWorkspace(candidate, cwd))
        ? current.filter((candidate) => !isSameWorkspace(candidate, cwd))
        : [...current, cwd]
    );
  }

  function renderSessionRow(candidate: SessionInfo, nested: boolean) {
    const isActive = activeSessionId != null && candidate.id === activeSessionId;
    if (isActive && renaming) {
      return (
        <div className={`agent-row-shell active ${nested ? "nested" : ""}`} key={candidate.path} role="listitem">
          <input
            className="agent-rename-input"
            value={renameValue}
            autoFocus
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); commitRename(); }
              if (event.key === "Escape") { event.preventDefault(); setRenaming(false); }
            }}
            aria-label={t("Rename thread", "重命名会话")}
          />
        </div>
      );
    }
    const failedSwitchError = failedSwitch?.path === candidate.path ? failedSwitch.error : null;
    return (
      <div
        key={candidate.path}
        className={`agent-row-shell ${isActive ? "active" : ""} ${nested ? "nested" : ""}`}
        role="listitem"
      >
        <button
          className={`agent-row ${isActive ? "active" : ""}`}
          type="button"
          disabled={!isActive && isStreaming}
          onClick={() => handleSwitchThread(candidate.path)}
          onDoubleClick={() => { if (isActive) beginRename(candidate); }}
          title={isActive
            ? t("Double-click to rename", "双击重命名")
            : isStreaming
              ? t("Finish or stop the current run before switching threads", "请先完成或停止当前运行，再切换会话")
              : undefined}
        >
          <span className="agent-row-title">
            {candidate.name ?? candidate.firstMessage ?? t("Untitled", "未命名")}
          </span>
        </button>
        <button
          className="agent-row-menu-trigger"
          type="button"
          aria-label={t("Actions for {name}", "{name} 的操作", {
            name: candidate.name ?? candidate.firstMessage ?? t("Untitled", "未命名"),
          })}
          aria-haspopup="menu"
          aria-expanded={sessionMenu?.session.path === candidate.path}
          onClick={(event) => openSessionMenu(event, candidate)}
        >
          <Icon name="more-horizontal" size={18} />
        </button>
        {failedSwitchError && (
          <div className="agent-row-error" role="alert">
            <span title={failedSwitchError}>{t("Could not open this thread", "无法打开此会话")}</span>
            <button
              className="agent-row-error-retry"
              type="button"
              disabled={isStreaming}
              onClick={() => void handleSwitchThread(candidate.path)}
            >
              {t("Retry", "重试")}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <aside className={`sidebar ${collapsed ? "collapsed" : ""}`} aria-label={t("Sidebar", "侧边栏")}>
      <div className="sidebar-header">
        {!collapsed && (
          <div className="brand-lockup">
            <BrandIcon className="brand-mark" />
            <span className="brand-copy">
              <strong className="brand-name">Pi Studio</strong>
              <span className="brand-tagline">{t("Coding agent", "编程智能体")}</span>
            </span>
          </div>
        )}
        <span className="sidebar-header-drag" />
        <button
          className="icon-button sidebar-toggle"
          type="button"
          aria-label={collapsed ? t("Expand sidebar", "展开侧边栏") : t("Collapse sidebar", "收起侧边栏")}
          onClick={onToggle}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M9 3v18" fill="none" stroke="currentColor" strokeWidth="1.5" />
            {collapsed
              ? <path d="m13 9 3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
              : <path d="m16 15-3-3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />}
          </svg>
        </button>
      </div>

      {collapsed ? (
        <div className="sidebar-rail">
          <button
            className="icon-button sidebar-rail-action"
            type="button"
            aria-label={t("New task", "新建任务")}
            title={isStreaming
              ? t("Finish or stop the current run before creating a new task", "请先完成或停止当前运行，再新建任务")
              : t("New task", "新建任务")}
            disabled={!backendStatus.ready || switchingWorkspace || isStreaming || creatingThread}
            onClick={handleNewTask}
          >
            <Icon name="plus" size={18} strokeWidth={1.6} />
          </button>
          {session && (
            <button
              className="icon-button sidebar-rail-action"
              type="button"
              aria-label={t("Export current thread", "导出当前会话")}
              title={t("Export current thread", "导出当前会话")}
              disabled={exporting}
              onClick={handleExport}
            >
              <Icon name="download" size={18} strokeWidth={1.5} />
            </button>
          )}
          <span className="sidebar-rail-spacer" />
          <button
            ref={workspaceTriggerRef}
            className="icon-button sidebar-rail-action sidebar-rail-workspace"
            type="button"
            aria-label={t(
              "Open workspace switcher. Current workspace: {workspace}. {status}",
              "打开工作区切换器。当前工作区：{workspace}。{status}",
              {
                workspace: workspaceName,
                status: isStreaming
                  ? t("Switching is unavailable while the agent is running.", "智能体运行时无法切换。")
                  : backendStatus.ready
                    ? t("Backend ready", "后端已就绪")
                    : t("Backend offline", "后端离线"),
              },
            )}
            aria-haspopup="menu"
            aria-expanded={workspaceMenu !== null}
            title={isStreaming
              ? t("View workspaces (switching is unavailable while the agent is running)", "查看工作区（智能体运行时无法切换）")
              : workspaceCwd || t("Choose workspace", "选择工作区")}
            disabled={switchingWorkspace}
            onClick={openWorkspaceMenu}
          >
            <Icon name="folder" size={18} strokeWidth={1.5} />
            <span className={`sidebar-rail-status-dot ${backendStatus.ready ? "ready" : ""}`} />
          </button>
          <button
            className="icon-button sidebar-rail-action"
            type="button"
            aria-label={t("Settings", "设置")}
            title={t("Settings", "设置")}
            onClick={() => openSettings("models-providers")}
          >
            <Icon name="settings" size={18} strokeWidth={1.5} />
          </button>
        </div>
      ) : (
        <>
          <button
            className="new-agent-button"
            type="button"
            disabled={!backendStatus.ready || switchingWorkspace || isStreaming || creatingThread}
            title={isStreaming
              ? t("Finish or stop the current run before creating a new task", "请先完成或停止当前运行，再新建任务")
              : !backendStatus.ready
                ? t("The agent backend is not ready", "智能体后端尚未就绪")
                : undefined}
            onClick={handleNewTask}
          >
            <Icon className="new-agent-icon" name="plus" size={18} strokeWidth={1.5} />
            <span>{t("New task", "新建任务")}</span>
          </button>

          <div className="agent-list-section">
            <div className="thread-search">
              <Icon className="thread-search-icon" name="search" size={18} strokeWidth={1.4} />
              <input
                className="thread-search-input"
                type="search"
                value={sessionQuery}
                onChange={(event) => setSessionQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && sessionQuery) {
                    event.preventDefault();
                    setSessionQuery("");
                  }
                }}
                placeholder={t("Search projects and tasks", "搜索项目和任务")}
                aria-label={t("Search projects and tasks", "搜索项目和任务")}
                maxLength={1000}
              />
              {sessionQuery && (
                <button
                  className="thread-search-clear"
                  type="button"
                  aria-label={t("Clear thread search", "清除会话搜索")}
                  onClick={() => setSessionQuery("")}
                >
                  <Icon name="close" size={18} strokeWidth={1.4} />
                </button>
              )}
            </div>
            <div className="agent-list ownership-list" aria-busy={sessionsLoading || sessionSearchPending}>
              {sessionsError && (
                <div className="agent-list-error" role="alert">
                  <span>
                    <strong>{t("Could not load threads", "无法加载会话")}</strong>
                    {sessionsError !== "Could not load threads" && <span title={sessionsError}>{sessionsError}</span>}
                  </span>
                  <button
                    className="agent-list-error-retry"
                    type="button"
                    disabled={sessionsLoading}
                    onClick={() => void refreshSessions()}
                  >
                    {sessionsLoading ? t("Retrying...", "正在重试...") : t("Retry", "重试")}
                  </button>
                </div>
              )}
              <section className="ownership-section project-tree" aria-labelledby="project-tree-title">
                <div className="ownership-section-header">
                  <span id="project-tree-title">{t("Projects", "项目")}</span>
                  <button
                    className="workspace-navigation-add"
                    type="button"
                    aria-label={t("Add project", "添加项目")}
                    title={isStreaming
                      ? t("Finish or stop the current run before adding a project", "请先完成或停止当前运行，再添加项目")
                      : t("Add project", "添加项目")}
                    disabled={switchingWorkspace || isStreaming}
                    onClick={handleChooseWorkspace}
                  >
                    <Icon name="plus" size={18} strokeWidth={1.5} />
                  </button>
                </div>
                {workspaceNavigationItems.length === 0 ? (
                  <button
                    className="workspace-navigation-empty"
                    type="button"
                    disabled={switchingWorkspace || isStreaming}
                    onClick={handleChooseWorkspace}
                  >
                    {t("Choose a folder to add your first project", "选择文件夹以添加第一个项目")}
                  </button>
                ) : (
                  <div className="project-tree-list" role="tree" aria-label={t("Projects", "项目")}>
                    {workspaceNavigationItems.map((cwd) => {
                      const isCurrent = !isTaskContext && isSameWorkspace(cwd, workspaceCwd);
                      const projectSessions = sessionOwnership.projects.find((project) => isSameWorkspace(project.cwd, cwd))?.sessions ?? [];
                      const hasProjectSessions = projectSessions.length > 0;
                      const isExpanded = hasProjectSessions && (
                        normalizedSessionQuery.length > 0 ||
                        expandedProjects.some((candidate) => isSameWorkspace(candidate, cwd))
                      );
                      const workspaceDisplay = getWorkspaceDisplayParts(cwd, workspaceNavigationItems);
                      return (
                        <div
                          className="project-tree-node"
                          key={cwd}
                          role="treeitem"
                          aria-expanded={hasProjectSessions ? isExpanded : undefined}
                        >
                          <div className={`project-tree-row ${isCurrent ? "active" : ""}`}>
                            {hasProjectSessions ? (
                              <button
                                className="project-tree-toggle"
                                type="button"
                                aria-label={isExpanded
                                  ? t("Collapse {project}", "收起 {project}", { project: workspaceDisplay.name })
                                  : t("Expand {project}", "展开 {project}", { project: workspaceDisplay.name })}
                                onClick={() => toggleProject(cwd)}
                              >
                                <Icon className={isExpanded ? "expanded" : ""} name="chevron-right" size={18} strokeWidth={1.4} />
                              </button>
                            ) : (
                              <span className="project-tree-toggle" aria-hidden="true" />
                            )}
                            <button
                              className="project-tree-main"
                              type="button"
                              aria-current={isCurrent ? "page" : undefined}
                              title={cwd}
                              disabled={switchingWorkspace || (!isCurrent && isStreaming)}
                              onClick={() => {
                                if (hasProjectSessions && !isExpanded) toggleProject(cwd);
                                void handleOpenWorkspace(cwd);
                              }}
                            >
                              <Icon name="folder" size={18} strokeWidth={1.5} />
                              <span className="workspace-navigation-copy">
                                <span>{workspaceDisplay.name}</span>
                                {workspaceDisplay.detail && <span>{workspaceDisplay.detail}</span>}
                              </span>
                              {isCurrent && (
                                <span className={`workspace-navigation-status ${backendStatus.ready && !switchingWorkspace ? "ready" : ""}`} role="img" aria-label={workspaceStatusText ?? undefined} />
                              )}
                            </button>
                            <button
                              className="project-tree-new"
                              type="button"
                              aria-label={t("New thread in {project}", "在 {project} 中新建会话", { project: workspaceDisplay.name })}
                              title={t("New thread in this project", "在此项目中新建会话")}
                              disabled={!backendStatus.ready || switchingWorkspace || isStreaming || creatingThread}
                              onClick={() => handleNewProjectThread(cwd)}
                            >
                              <Icon name="plus" size={18} strokeWidth={1.5} />
                            </button>
                          </div>
                          {hasProjectSessions && isExpanded && (
                            <div className="project-tree-children" role="group">
                              {projectSessions.map((candidate) => renderSessionRow(candidate, true))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="ownership-section task-tree" aria-labelledby="task-tree-title">
                <div className="ownership-section-header">
                  <span id="task-tree-title">{t("Tasks", "任务")}</span>
                  <span className="agent-list-count" role="img" aria-label={t("{count} tasks", "{count} 个任务", { count: taskSessions.length })}>
                    {taskSessions.length}
                  </span>
                  <button
                    className="workspace-navigation-add"
                    type="button"
                    aria-label={t("New task", "新建任务")}
                    title={isStreaming
                      ? t("Finish or stop the current run before creating a new task", "请先完成或停止当前运行，再新建任务")
                      : !backendStatus.ready
                        ? t("The agent backend is not ready", "智能体后端尚未就绪")
                        : t("New task", "新建任务")}
                    disabled={!backendStatus.ready || switchingWorkspace || isStreaming || creatingThread}
                    onClick={handleNewTask}
                  >
                    <Icon name="plus" size={18} strokeWidth={1.5} />
                  </button>
                </div>
                <div className="task-tree-list" role="list">
                  {taskSessions.map((candidate) => renderSessionRow(candidate, false))}
                  {!sessionsError && !sessionsLoading && !sessionSearchPending && taskSessions.length === 0 && (
                    <div className="agent-empty-state">
                      {normalizedSessionQuery
                        ? t("No tasks match “{query}”", "没有与“{query}”匹配的任务", { query: sessionsQuery })
                        : t("No tasks yet", "尚无任务")}
                    </div>
                  )}
                </div>
              </section>
              {(sessionsLoading || sessionSearchPending) && sessions.length === 0 && (
                <div className="agent-empty-state">
                  {sessionLoadingText}
                </div>
              )}
              {sessionsHasMore && sessions.length > 0 && (
                <div className="agent-list-pagination">
                  <button
                    className="agent-list-load-more"
                    type="button"
                    disabled={sessionsLoading || sessionSearchPending}
                    onClick={() => void loadMoreSessions()}
                  >
                    {sessionsLoading ? t("Loading...", "正在加载...") : t("Load older items", "加载更早内容")}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="sidebar-footer">
            <button
              className="sidebar-action-btn"
              type="button"
              onClick={() => openSettings("models-providers")}
              title={t("Open settings", "打开设置")}
            >
              <Icon name="settings" size={14} strokeWidth={1.5} />
              <span>{t("Settings", "设置")}</span>
            </button>
            <div className="status-row" title={backendStatus.error}>
              <span
                className={`backend-dot ${backendStatus.ready && !switchingWorkspace ? "ready" : ""}`}
                role="img"
                aria-label={
                  switchingWorkspace
                    ? workspaceStatusText ?? undefined
                    : backendStatus.ready
                      ? t("Backend running", "后端正在运行")
                      : workspaceStatusText ?? undefined
                }
              />
              <span className="status-text">{workspaceStatusText ?? ""}</span>
              {!backendStatus.ready && !backendStatus.starting && !backendStatus.restarting && (
                <button className="status-row-retry" type="button" onClick={handleRestartBackend}>
                  {t("Retry", "重试")}
                </button>
              )}
            </div>
          </div>
        </>
      )}
      </aside>
      {sessionMenu && createPortal(
        <div
          ref={menuRef}
          className="session-actions-menu"
          role="menu"
          aria-label={t("Thread actions", "会话操作")}
          style={{ left: sessionMenu.left, top: sessionMenu.top }}
          onKeyDown={handleSessionMenuKeyDown}
          onBlur={(event) => {
            if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
            closeSessionMenu();
          }}
        >
          {sessionMenu.session.id === activeSessionId && (
            <>
              <button
                className="session-actions-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  const candidate = sessionMenu.session;
                  closeSessionMenu();
                  beginRename(candidate);
                }}
              >
                {t("Rename", "重命名")}
              </button>
              <button
                className="session-actions-item"
                type="button"
                role="menuitem"
                disabled={exporting}
                onClick={() => {
                  closeSessionMenu();
                  void handleExport();
                }}
              >
                {exporting ? t("Exporting...", "正在导出...") : t("Export HTML", "导出 HTML")}
              </button>
              <button
                className="session-actions-item"
                type="button"
                role="menuitem"
                disabled={cloning || isStreaming}
                title={isStreaming
                  ? t("Finish or stop the current run before cloning this thread", "请先完成或停止当前运行，再克隆此会话")
                  : undefined}
                onClick={() => void handleCloneSession()}
              >
                {cloning ? t("Cloning...", "正在克隆...") : t("Clone thread", "克隆会话")}
              </button>
              <button
                className="session-actions-item"
                type="button"
                role="menuitem"
                disabled={isStreaming}
                title={isStreaming
                  ? t("Finish or stop the current run before browsing branches", "请先完成或停止当前运行，再浏览分支")
                  : undefined}
                onClick={() => {
                  closeSessionMenu(true);
                  requestAnimationFrame(() => setBranchNavigatorOpen(true));
                }}
              >
                {t("Browse branches", "浏览分支")}
              </button>
              <div className="session-actions-separator" role="separator" />
            </>
          )}
          <button
            className="session-actions-item"
            type="button"
            role="menuitem"
            onClick={() => handleRevealSession(sessionMenu.session)}
          >
            {t("Show in File Explorer", "在文件资源管理器中显示")}
          </button>
          <div className="session-actions-separator" role="separator" />
          <button
            className="session-actions-item danger"
            type="button"
            role="menuitem"
            disabled={sessionMenu.session.id === activeSessionId}
            title={sessionMenu.session.id === activeSessionId
              ? t("Switch to another thread before deleting", "请先切换到其他会话再删除")
              : undefined}
            onClick={() => {
              const candidate = sessionMenu.session;
              closeSessionMenu();
              setDeleteTarget(candidate);
            }}
          >
            {t("Delete", "删除")}
          </button>
        </div>,
        document.body,
      )}
      {workspaceMenu && createPortal(
        <div
          ref={workspaceMenuRef}
          className="workspace-menu"
          role="menu"
          aria-label={t("Workspace switcher", "工作区切换器")}
          style={{ left: workspaceMenu.left, top: workspaceMenu.top }}
          onKeyDown={handleWorkspaceMenuKeyDown}
          onBlur={(event) => {
            if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
            closeWorkspaceMenu();
          }}
        >
          <div className="workspace-menu-current">
            <span className="workspace-menu-eyebrow">{t("Current context", "当前上下文")}</span>
            <span className="workspace-menu-current-row">
              <span className={`backend-dot ${backendStatus.ready ? "ready" : ""}`} aria-hidden="true" />
              <strong>{workspaceName}</strong>
            </span>
            <span className="workspace-menu-path" title={workspaceCwd}>
              {workspaceCwd || t("No folder selected", "未选择文件夹")}
            </span>
          </div>

          <div className="workspace-menu-separator" role="separator" />
          <div className="workspace-menu-label">{t("Projects", "项目")}</div>
          <div className="workspace-menu-list">
            {otherWorkspaces.length === 0 ? (
              <p className="workspace-menu-empty">{t("No other workspaces added", "尚未添加其他工作区")}</p>
            ) : (
              otherWorkspaces.map((cwd) => {
                const workspaceDisplay = getWorkspaceDisplayParts(cwd, workspaceNavigationItems);
                return (
                  <div className="workspace-menu-entry" key={cwd}>
                  <button
                    className="workspace-menu-item workspace-menu-workspace"
                    type="button"
                    role="menuitem"
                    title={cwd}
                    disabled={isStreaming || switchingWorkspace}
                    onClick={() => handleOpenWorkspace(cwd)}
                  >
                    <Icon name="folder" size={18} strokeWidth={1.5} />
                    <span className="workspace-menu-item-copy">
                      <strong>{workspaceDisplay.name}</strong>
                      <span>{workspaceDisplay.detail ?? cwd}</span>
                    </span>
                  </button>
                  <button
                    className="workspace-menu-remove"
                    type="button"
                    role="menuitem"
                    aria-label={t(
                      "Remove {workspace} from the workspace list without deleting files",
                      "从工作区列表中移除 {workspace}，但不删除文件",
                      { workspace: getWorkspaceName(cwd) },
                    )}
                    title={t(
                      "Remove from list without deleting files: {path}",
                      "从列表中移除但不删除文件：{path}",
                      { path: cwd },
                    )}
                    disabled={switchingWorkspace}
                    onClick={() => handleRemoveWorkspace(cwd)}
                  >
                    <Icon name="close" size={18} strokeWidth={1.4} />
                  </button>
                </div>
                );
              })
            )}
          </div>

          <div className="workspace-menu-separator" role="separator" />
          <button
            className="workspace-menu-item"
            type="button"
            role="menuitem"
            disabled={isStreaming || switchingWorkspace}
            onClick={handleChooseWorkspace}
          >
            <Icon name="plus" size={18} strokeWidth={1.5} />
            <span>{t("Add workspace...", "添加工作区...")}</span>
          </button>
          {otherWorkspaces.length > 0 && (
            <button
              className="workspace-menu-item workspace-menu-clear"
              type="button"
              role="menuitem"
              disabled={switchingWorkspace}
              onClick={handleClearOtherWorkspaces}
            >
              <Icon name="trash" size={18} strokeWidth={1.5} />
              <span>{t("Clear other workspaces", "清除其他工作区")}</span>
            </button>
          )}
        </div>,
        document.body,
      )}
      <BranchNavigator
        open={branchNavigatorOpen}
        onClose={() => setBranchNavigatorOpen(false)}
        onSessionChanged={() => useStore.getState().refreshAsync()}
      />
      <Dialog
        open={deleteTarget !== null}
        title={t("Delete thread?", "删除会话？")}
        onClose={deleting ? undefined : closeDeleteDialog}
        actions={
          <>
            <button className="dialog-btn dialog-btn-secondary" type="button" disabled={deleting} onClick={closeDeleteDialog}>
              {t("Cancel", "取消")}
            </button>
            <button
              className="dialog-btn dialog-btn-danger"
              type="button"
              disabled={deleting || Boolean(deletingActiveSession)}
              onClick={handleDeleteSession}
            >
              {deleting ? t("Deleting...", "正在删除...") : t("Delete", "删除")}
            </button>
          </>
        }
      >
        <p className="session-delete-copy">
          {t("This moves", "这会将")}{" "}
          <strong>{deleteTarget?.name ?? deleteTarget?.firstMessage ?? t("Untitled", "未命名")}</strong>{" "}
          {t("to the Recycle Bin.", "移至回收站。")}
          {deletingActiveSession ? t(" Switch to another thread first.", " 请先切换到其他会话。") : ""}
        </p>
        {deletingActiveSession && (
          <p className="session-delete-warning">{t("The active thread cannot be deleted.", "无法删除当前会话。")}</p>
        )}
      </Dialog>
    </>
  );
}
