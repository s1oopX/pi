import { create } from "zustand";
import type {
  AuthStatus,
  BackendStatus,
  CustomModelsConfig,
  ExtensionUIRequestEvent,
  LogEntry,
  Message,
  Model,
  SessionInfo,
  SessionState,
  SessionStats,
  SlashCommand,
  WorkspaceGitStatus,
} from "../ipc/types";
import * as api from "../ipc/api";
import type { ExtensionWidgetPlacement } from "../ipc/extensionUIEffects";
import {
  reduceAgentActivity,
  type AgentActivityEvent,
  type CompactionActivity,
  type RetryActivity,
} from "./agentActivity";
import { reconcileMessageSnapshot, type MessageEventType, reduceMessageEvent } from "./messageCursor";
import {
  appendApprovalHistory,
  decisionFromResponse,
  summarizeApprovalRequest,
  type ApprovalHistoryEntry,
} from "./approvalHistory";
import { shouldApplyMessageRefresh } from "./messageRefreshGuard";
import {
  createInitialTaskRegistryState,
  mergeTaskList,
  PRIMARY_TASK_ID,
  switchTask,
  type TaskRegistryState,
} from "./taskRegistry";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<Theme, "system">;
export type PermissionMode = "full" | "auto" | "ask";
export type ToolExecutionPhase = "queued" | "running" | "done" | "error";

export interface ToolExecutionRecord {
  toolName: string;
  phase: ToolExecutionPhase;
  /** Throttled live output snapshot while the tool is running. */
  liveOutput?: string;
}

export type ToolExecutionsByCallId = Record<string, ToolExecutionRecord>;

export interface ExtensionWidgetState {
  key: string;
  lines: string[];
  placement: ExtensionWidgetPlacement;
  order: number;
}

export type ComposerDraft = string | ((current: string) => string);

export type SettingsRoute =
  | null
  | "models-providers"
  | "custom-providers"
  | "account"
  | "agent-general"
  | "appearance"
  | "shortcuts"
  | "resources"
  | "about";

export interface AppInfo {
  name: string;
  version: string;
}

export interface AppState {
  // Backend connection
  backendStatus: BackendStatus;
  logs: LogEntry[];

  // Session
  session: SessionState | null;
  messages: Message[];
  /** Bumped on workspace reset / full refresh start so stale get_messages cannot apply. */
  messageRefreshGeneration: number;
  stats: SessionStats | undefined;
  sessions: SessionInfo[];
  sessionsTotal: number;
  sessionsHasMore: boolean;
  sessionsNextOffset: number | null;
  sessionsQuery: string;
  sessionsLoading: boolean;
  sessionsError: string | null;

  // Models
  models: Model[];
  customModelsConfig: CustomModelsConfig | null;
  authStatuses: Record<string, AuthStatus>;

  // Commands
  commands: SlashCommand[];

  // Workspace
  workspaceCwd: string;
  taskCwd: string;
  workspaceFiles: string[];
  workspaceGitStatus: WorkspaceGitStatus | null;
  workspaceGitStatusLoading: boolean;
  // True from the moment a workspace switch/reset begins until the first full
  // refresh of the new workspace lands. Set synchronously so the UI never
  // flashes the empty-state home cards in the gap before the backend status
  // event reports the restart.
  workspaceLoading: boolean;

  // UI state
  isStreaming: boolean;
  activeTool: string | null;
  toolExecutionsByCallId: ToolExecutionsByCallId;
  extensionUIRequests: ExtensionUIRequestEvent[];
  approvalHistory: ApprovalHistoryEntry[];
  extensionStatuses: Record<string, string>;
  extensionWidgets: ExtensionWidgetState[];
  extensionTitle: string | null;
  queuedSteering: string[];
  queuedFollowUp: string[];
  retryActivity: RetryActivity | null;
  compactionActivity: CompactionActivity | null;

  // Draft text pushed into the Composer from elsewhere (e.g. empty-state cards).
  // The Composer consumes it, prefills its local input, then clears it.
  composerDraft: ComposerDraft | null;

  // Streaming cursor: index of the message opened by the current message_start,
  // or null when no message is actively streaming. Message events carry no
  // stable top-level id, so this deterministic cursor is the source of truth for
  // which message message_update mutates.
  activeMessageIndex: number | null;

  // Theme & App
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  appInfo: AppInfo | null;
  settingsRoute: SettingsRoute;

  // Permission mode (tool approval tier). Lives in the backend extension
  // runtime as a flag; this is the UI-side source of truth, persisted to
  // localStorage and re-pushed to the backend whenever it (re)connects.
  permissionMode: PermissionMode;

  // Parallel tasks (M2): per-task summaries and the active selection. The
  // active task renders through the single-conversation fields above;
  // background tasks only update these summaries until switched to.
  taskRegistry: TaskRegistryState;

  // Actions
  updateBackendStatus: (status: BackendStatus) => void;
  addLog: (entry: LogEntry) => void;
  setStreaming: (streaming: boolean) => void;
  queueToolExecutions: (calls: readonly { callId: string; toolName: string }[]) => void;
  startToolExecution: (callId: string, toolName: string) => void;
  updateToolExecutionOutput: (callId: string, toolName: string, output: string) => void;
  finishToolExecution: (callId: string, toolName: string, isError: boolean) => void;
  clearToolExecutions: () => void;
  upsertMessage: (message: Message, eventType: MessageEventType) => void;
  addExtensionUIRequest: (request: ExtensionUIRequestEvent) => void;
  recordApprovalDecision: (request: ExtensionUIRequestEvent, response: unknown) => void;
  removeExtensionUIRequest: (id: string) => void;
  setExtensionStatus: (key: string, text: string | undefined) => void;
  setExtensionWidget: (key: string, lines: string[] | undefined, placement: ExtensionWidgetPlacement) => void;
  setExtensionTitle: (title: string | null) => void;
  updateAgentActivity: (event: AgentActivityEvent) => void;
  setTheme: (theme: Theme) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  openSettings: (route: SettingsRoute) => void;
  closeSettings: () => void;
  setComposerDraft: (text: ComposerDraft | null) => void;
  resetForWorkspace: (cwd: string, options?: { gitRefresh?: boolean; ready?: boolean }) => Promise<void>;
  refreshWorkspaceGitStatus: () => void;
  setTaskRegistry: (taskRegistry: TaskRegistryState) => void;
  refreshTasks: () => Promise<void>;
  switchActiveTask: (taskId: string) => Promise<void>;
  setSessionsQuery: (query: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
  loadMoreSessions: () => Promise<void>;
  refresh: () => void;
  refreshAsync: () => Promise<void>;
  refreshSession: () => void;
  initialize: () => void;
}

const MAX_LOGS = 200;
const THEME_STORAGE_KEY = "pi-studio-theme";
const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";
const PERMISSION_MODE_STORAGE_KEY = "pi-studio-permission-mode";
const PERMISSION_FLAG_NAME = "permission-mode";

function loadSavedTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {}
  return "system";
}

function loadSavedPermissionMode(): PermissionMode {
  try {
    const saved = localStorage.getItem(PERMISSION_MODE_STORAGE_KEY);
    if (saved === "full" || saved === "auto" || saved === "ask") return saved;
  } catch {}
  return "ask";
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== "system") return theme;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? "dark" : "light";
}

function applyThemeToDocument(theme: Theme): ResolvedTheme {
  const resolvedTheme = resolveTheme(theme);
  if (typeof document === "undefined") return resolvedTheme;
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme;
  root.dataset.themeMode = theme;
  root.style.colorScheme = resolvedTheme;
  return resolvedTheme;
}

// Pushes the permission mode to the backend extension runtime via the
// set_extension_flag RPC command. Best-effort: if the backend isn't reachable
// the local state and localStorage still reflect the user's choice, and the
// value is re-pushed on the next ready transition.
async function pushPermissionMode(mode: PermissionMode): Promise<void> {
  try {
    await api.setExtensionFlag(PERMISSION_FLAG_NAME, mode);
  } catch {
    // Backend not ready; will be re-pushed on next ready transition.
  }
}

const initialTheme = loadSavedTheme();
const initialResolvedTheme = applyThemeToDocument(initialTheme);
let systemThemeListenerInitialized = false;
let nextExtensionWidgetOrder = 0;
let gitStatusRequestId = 0;
let sessionListRequestId = 0;
let stateRefreshRequestId = 0;
let fullStateRefreshRequestId = 0;
let latestAppliedStateRefreshRequestId = 0;
let fullStateRefreshGeneration = 0;
let latestAppliedFullStateRefreshRequestId = 0;
const activeFullStateRefreshes = new Set<number>();

function invalidateStateRefreshScope(): void {
  // A session/workspace mutation changes the meaning of every in-flight
  // snapshot. Keep request ids monotonic while advancing the scope epoch so
  // an older full refresh cannot take the same-scope fallback path.
  stateRefreshRequestId += 1;
  fullStateRefreshRequestId += 1;
  fullStateRefreshGeneration += 1;
  activeFullStateRefreshes.clear();
}

function ensureSystemThemeListener(): void {
  if (systemThemeListenerInitialized || typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return;
  }

  const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);
  mediaQuery.addEventListener("change", () => {
    const state = useStore.getState();
    if (state.theme !== "system") return;
    const resolvedTheme = applyThemeToDocument("system");
    if (resolvedTheme !== state.resolvedTheme) {
      useStore.setState({ resolvedTheme });
    }
  });
  systemThemeListenerInitialized = true;
}

function deriveActiveTool(executions: ToolExecutionsByCallId): string | null {
  const records = Object.values(executions);
  for (let index = records.length - 1; index >= 0; index--) {
    if (records[index].phase === "running") return records[index].toolName;
  }
  return null;
}

export const useStore = create<AppState>((set, get) => ({
  backendStatus: {
    ready: false,
    starting: false,
    restarting: false,
    retryInMs: 0,
    restartAttempts: 0,
    backendPath: "",
    cwd: "",
  },
  logs: [],

  session: null,
  messages: [],
  messageRefreshGeneration: 0,
  stats: undefined,
  sessions: [],
  sessionsTotal: 0,
  sessionsHasMore: false,
  sessionsNextOffset: null,
  sessionsQuery: "",
  sessionsLoading: false,
  sessionsError: null,

  models: [],
  customModelsConfig: null,
  authStatuses: {},

  commands: [],

  workspaceCwd: "",
  taskCwd: "",
  workspaceFiles: [],
  workspaceGitStatus: null,
  workspaceGitStatusLoading: false,
  workspaceLoading: false,

  isStreaming: false,
  activeTool: null,
  toolExecutionsByCallId: {},
  extensionUIRequests: [],
  approvalHistory: [],
  extensionStatuses: {},
  extensionWidgets: [],
  extensionTitle: null,
  queuedSteering: [],
  queuedFollowUp: [],
  retryActivity: null,
  compactionActivity: null,
  composerDraft: null,
  activeMessageIndex: null,

  theme: initialTheme,
  resolvedTheme: initialResolvedTheme,
  appInfo: null,
  settingsRoute: null,
  permissionMode: loadSavedPermissionMode(),
  taskRegistry: createInitialTaskRegistryState(),

  updateBackendStatus(status) {
    const wasReady = get().backendStatus.ready;
    if (status.ready) {
      set({ backendStatus: status });
    } else {
      // Invalidate in-flight snapshots when the backend disconnects. Their
      // responses may still arrive after a restart and belong to the old run.
      invalidateStateRefreshScope();
      nextExtensionWidgetOrder = 0;
      if (typeof document !== "undefined") document.title = get().appInfo?.name ?? "Pi Studio";
      // Release the silent-loading hold once the backend settles into a terminal
      // offline state (not starting/restarting/retrying) so the empty state can
      // surface its retry affordance instead of spinning forever.
      const settledOffline = !status.starting && !status.restarting && status.retryInMs <= 0;
      set({
        backendStatus: status,
        messageRefreshGeneration: get().messageRefreshGeneration + 1,
        isStreaming: false,
        activeMessageIndex: null,
        retryActivity: null,
        compactionActivity: null,
        extensionUIRequests: [],
        extensionStatuses: {},
        extensionWidgets: [],
        extensionTitle: null,
        ...(settledOffline ? { workspaceLoading: false } : {}),
      });
    }
    // The backend flag resets to its default whenever the backend (re)starts,
    // so re-push the UI's chosen permission mode on each ready transition.
    if (status.ready && !wasReady) {
      if (get().workspaceCwd) get().refresh();
      void pushPermissionMode(get().permissionMode);
    }
  },

  addLog(entry) {
    set((s) => ({
      logs: [...s.logs.slice(-(MAX_LOGS - 1)), entry],
    }));
  },

  setStreaming(streaming) {
    set({ isStreaming: streaming });
  },

  queueToolExecutions(calls) {
    set((state) => {
      const toolExecutionsByCallId = { ...state.toolExecutionsByCallId };
      let changed = false;
      for (const call of calls) {
        if (toolExecutionsByCallId[call.callId]) continue;
        toolExecutionsByCallId[call.callId] = { toolName: call.toolName, phase: "queued" };
        changed = true;
      }
      return changed ? { toolExecutionsByCallId } : state;
    });
  },

  startToolExecution(callId, toolName) {
    set((state) => {
      const toolExecutionsByCallId = {
        ...state.toolExecutionsByCallId,
        [callId]: { toolName, phase: "running" as const },
      };
      return { toolExecutionsByCallId, activeTool: deriveActiveTool(toolExecutionsByCallId) };
    });
  },

  updateToolExecutionOutput(callId, toolName, output) {
    set((state) => {
      const current = state.toolExecutionsByCallId[callId];
      // A late throttled update must not resurrect a finished execution.
      if (current && current.phase !== "running" && current.phase !== "queued") return state;
      const toolExecutionsByCallId = {
        ...state.toolExecutionsByCallId,
        [callId]: { toolName, phase: "running" as const, liveOutput: output },
      };
      return { toolExecutionsByCallId, activeTool: deriveActiveTool(toolExecutionsByCallId) };
    });
  },

  finishToolExecution(callId, toolName, isError) {
    set((state) => {
      const toolExecutionsByCallId = {
        ...state.toolExecutionsByCallId,
        [callId]: { toolName, phase: isError ? "error" as const : "done" as const },
      };
      return { toolExecutionsByCallId, activeTool: deriveActiveTool(toolExecutionsByCallId) };
    });
  },

  clearToolExecutions() {
    set({ toolExecutionsByCallId: {}, activeTool: null });
  },

  upsertMessage(message, eventType) {
    set((s) =>
      reduceMessageEvent({ messages: s.messages, activeMessageIndex: s.activeMessageIndex }, message, eventType),
    );
  },

  addExtensionUIRequest(request) {
    set((state) => {
      const existingIndex = state.extensionUIRequests.findIndex(({ id }) => id === request.id);
      if (existingIndex === -1) {
        return { extensionUIRequests: [...state.extensionUIRequests, request] };
      }
      const extensionUIRequests = [...state.extensionUIRequests];
      extensionUIRequests[existingIndex] = request;
      return { extensionUIRequests };
    });
  },

  recordApprovalDecision(request, response) {
    const summary = summarizeApprovalRequest({
      method: request.method,
      params: {
        title: typeof request.title === "string" ? request.title : undefined,
        message: typeof request.message === "string" ? request.message : undefined,
      },
    });
    set((s) => ({
      approvalHistory: appendApprovalHistory(s.approvalHistory, {
        id: `${request.id}:${Date.now()}`,
        method: request.method,
        summary,
        decision: decisionFromResponse(request.method, response),
        timestamp: Date.now(),
      }),
    }));
  },

  removeExtensionUIRequest(id) {
    set((s) => ({
      extensionUIRequests: s.extensionUIRequests.filter((r) => r.id !== id),
    }));
  },

  setTheme(theme) {
    const resolvedTheme = applyThemeToDocument(theme);
    set({ theme, resolvedTheme });
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch {}
  },

  setExtensionStatus(key, text) {
    set((state) => {
      const extensionStatuses = { ...state.extensionStatuses };
      if (text === undefined) delete extensionStatuses[key];
      else extensionStatuses[key] = text;
      return { extensionStatuses };
    });
  },

  setExtensionWidget(key, lines, placement) {
    set((state) => {
      if (lines === undefined) {
        return { extensionWidgets: state.extensionWidgets.filter((widget) => widget.key !== key) };
      }
      const existing = state.extensionWidgets.find((widget) => widget.key === key);
      const nextWidget: ExtensionWidgetState = {
        key,
        lines: [...lines],
        placement,
        order: existing?.order ?? nextExtensionWidgetOrder++,
      };
      return {
        extensionWidgets: existing
          ? state.extensionWidgets.map((widget) => widget.key === key ? nextWidget : widget)
          : [...state.extensionWidgets, nextWidget],
      };
    });
  },

  setExtensionTitle(title) {
    set({ extensionTitle: title });
    if (typeof document !== "undefined") document.title = title ?? get().appInfo?.name ?? "Pi Studio";
  },

  updateAgentActivity(event) {
    set((state) => reduceAgentActivity({
      retryActivity: state.retryActivity,
      compactionActivity: state.compactionActivity,
    }, event));
  },

  setPermissionMode(mode) {
    set({ permissionMode: mode });
    try { localStorage.setItem(PERMISSION_MODE_STORAGE_KEY, mode); } catch {}
    void pushPermissionMode(mode);
  },

  openSettings(route) {
    set({ settingsRoute: route });
  },

  closeSettings() {
    set({ settingsRoute: null });
  },

  setComposerDraft(text) {
    set({ composerDraft: text });
  },

  resetForWorkspace(cwd, options) {
    invalidateStateRefreshScope();
    nextExtensionWidgetOrder = 0;
    if (typeof document !== "undefined") document.title = get().appInfo?.name ?? "Pi Studio";
    set({
      workspaceCwd: cwd,
      workspaceLoading: true,
      workspaceFiles: [],
      workspaceGitStatus: null,
      workspaceGitStatusLoading: false,
      session: null,
      messages: [],
      messageRefreshGeneration: get().messageRefreshGeneration + 1,
      stats: undefined,
      models: [],
      customModelsConfig: null,
      authStatuses: {},
      commands: [],
      isStreaming: false,
      activeTool: null,
      toolExecutionsByCallId: {},
      extensionUIRequests: [],
      extensionStatuses: {},
      extensionWidgets: [],
      extensionTitle: null,
      queuedSteering: [],
      queuedFollowUp: [],
      retryActivity: null,
      compactionActivity: null,
      composerDraft: null,
      activeMessageIndex: null,
    });
    // Pool tasks skip the git refresh: the workspace git IPC is primary-only
    // in M2 and would report the wrong folder.
    if (options?.gitRefresh !== false) void refreshWorkspaceGitStatus();
    const ready = options?.ready ?? get().backendStatus.ready;
    return ready ? get().refreshAsync() : Promise.resolve();
  },

  refreshWorkspaceGitStatus() {
    void refreshWorkspaceGitStatus();
  },

  setTaskRegistry(taskRegistry) {
    set({ taskRegistry });
  },

  async refreshTasks() {
    try {
      const tasks = await api.listTasks();
      if (tasks.length > 0) {
        set({ taskRegistry: mergeTaskList(get().taskRegistry, tasks) });
      }
    } catch {
      // The task list is auxiliary; never let a failed poll break the UI.
    }
  },

  async switchActiveTask(taskId) {
    const registry = get().taskRegistry;
    const target = registry.tasks[taskId];
    if (!target || registry.activeTaskId === taskId) return;
    const isPrimary = taskId === PRIMARY_TASK_ID;
    // All backend traffic from here on targets the switched-to task; the
    // conversation then rehydrates through the existing workspace-reset path
    // without restarting any backend process.
    api.setActiveBackendTask(isPrimary ? undefined : taskId);
    set({ taskRegistry: switchTask(registry, taskId) });
    await get().resetForWorkspace(target.cwd || get().workspaceCwd, {
      gitRefresh: isPrimary,
      ready: isPrimary ? get().backendStatus.ready : target.ready,
    });
  },

  async setSessionsQuery(query) {
    await loadSessionPage(query.trim(), 0, false);
  },

  async refreshSessions() {
    await loadSessionPage(get().sessionsQuery, 0, false);
  },

  async loadMoreSessions() {
    const state = get();
    if (state.sessionsLoading || !state.sessionsHasMore || state.sessionsNextOffset === null) return;
    await loadSessionPage(state.sessionsQuery, state.sessionsNextOffset, true);
  },

  refresh() {
    void refreshState();
  },

  refreshAsync() {
    return refreshState();
  },

  refreshSession() {
    void refreshSessionState();
  },

  initialize() {
    ensureSystemThemeListener();
    const resolvedTheme = applyThemeToDocument(get().theme);
    if (resolvedTheme !== get().resolvedTheme) {
      set({ resolvedTheme });
    }

    api.getBackendStatus().then((status) => {
      get().updateBackendStatus(status);
    }).catch(() => {});

    void get().refreshTasks();

    api.getWorkspace().then(({ cwd, taskCwd }) => {
      set({ taskCwd });
      if (get().workspaceCwd !== cwd) {
        get().resetForWorkspace(cwd);
      } else {
        void refreshWorkspaceGitStatus();
        if (get().backendStatus.ready) get().refresh();
      }
    }).catch(() => {});

    api.getAppInfo().then((info) => {
      set({ appInfo: info });
      if (get().extensionTitle === null && typeof document !== "undefined") document.title = info.name;
    }).catch(() => {});
  },
}));

async function refreshState(): Promise<void> {
  const requestId = ++stateRefreshRequestId;
  const fullRequestId = ++fullStateRefreshRequestId;
  const fullGeneration = fullStateRefreshGeneration;
  activeFullStateRefreshes.add(fullRequestId);
  let refreshFailed = false;
  useStore.setState((state) => ({
    toolExecutionsByCallId: {},
    activeTool: null,
    messageRefreshGeneration: state.messageRefreshGeneration + 1,
  }));
  const generation = useStore.getState().messageRefreshGeneration;
  const workspaceCwd = useStore.getState().workspaceCwd;

  try {
    if (!api.getApi()) {
      refreshFailed = true;
      return;
    }

    void loadSessionPage(useStore.getState().sessionsQuery, 0, false);

    const [session, messages, models, customModels, stats, commands] = await Promise.all([
      api.getState(),
      api.getMessages(),
      api.getAvailableModels().catch(() => [] as Model[]),
      api.getCustomModels().catch(() => null),
      api.getSessionStats().catch(() => undefined),
      api.getCommands().catch(() => [] as SlashCommand[]),
    ]);

    if (
      fullGeneration !== fullStateRefreshGeneration ||
      fullRequestId < latestAppliedFullStateRefreshRequestId
    ) return;
    const authStatuses = await api.getAuthStatus().catch(() => ({}) as Record<string, AuthStatus>);
    if (
      fullGeneration !== fullStateRefreshGeneration ||
      fullRequestId < latestAppliedFullStateRefreshRequestId
    ) return;
    const current = useStore.getState();
    const snapshotIsCurrent = requestId === stateRefreshRequestId;
    const newerSnapshotApplied = latestAppliedStateRefreshRequestId > requestId;
    const decision = shouldApplyMessageRefresh(
      {
        workspaceCwd: current.workspaceCwd,
        generation: current.messageRefreshGeneration,
        isStreaming: current.isStreaming,
        messageCount: current.messages.length,
        activeMessageIndex: current.activeMessageIndex,
      },
      {
        workspaceCwd,
        generation,
        messageCount: messages.length,
      },
    );

    const workspaceMatches = normalizeWorkspaceKey(current.workspaceCwd) === normalizeWorkspaceKey(workspaceCwd);

    const initialFullFallback =
      !decision.apply &&
      decision.reason === "stale-generation" &&
      !newerSnapshotApplied &&
      workspaceMatches &&
      current.backendStatus.ready &&
      current.session === null &&
      current.messages.length === 0;

    if (!snapshotIsCurrent && !initialFullFallback) {
      // A newer request owns the session/message snapshot even when it fails:
      // an older same-length partial must not overwrite finalized events. The
      // full refresh may still supply catalog data and release initial loading.
      if (!workspaceMatches || !current.backendStatus.ready) return;
      latestAppliedFullStateRefreshRequestId = fullRequestId;
      useStore.setState({
        models,
        customModelsConfig: customModels,
        commands,
        authStatuses,
        workspaceLoading: false,
      });
      void refreshWorkspaceGitStatus();
      return;
    }

    if (!decision.apply) {
      // Only an empty initial load may fall back to an older full snapshot.
      // Once a session or event state exists, keeping it is safer than
      // restoring an older snapshot after a newer request failed.
      if ((decision.reason !== "streaming-shrink" || !workspaceMatches) && !initialFullFallback) return;
      latestAppliedFullStateRefreshRequestId = fullRequestId;
      latestAppliedStateRefreshRequestId = requestId;
      useStore.setState({
        session,
        models,
        customModelsConfig: customModels,
        stats,
        commands,
        authStatuses,
        isStreaming: current.isStreaming || Boolean(session?.isStreaming),
        workspaceLoading: false,
      });
      void refreshWorkspaceGitStatus();
      return;
    }

    const messageState = reconcileMessageSnapshot(
      { messages: current.messages, activeMessageIndex: current.activeMessageIndex },
      messages,
      current.isStreaming || Boolean(session?.isStreaming),
    );
    latestAppliedFullStateRefreshRequestId = fullRequestId;
    latestAppliedStateRefreshRequestId = requestId;
    useStore.setState({
      session,
      ...messageState,
      models,
      customModelsConfig: customModels,
      stats,
      commands,
      authStatuses,
      isStreaming: current.isStreaming || Boolean(session?.isStreaming),
      workspaceLoading: false,
    });
    void refreshWorkspaceGitStatus();
  } catch {
    refreshFailed = true;
  } finally {
    activeFullStateRefreshes.delete(fullRequestId);
    if (refreshFailed && activeFullStateRefreshes.size === 0) {
      releaseWorkspaceLoadingAfterFailedRefresh(workspaceCwd, generation);
    }
  }
}

function releaseWorkspaceLoadingAfterFailedRefresh(workspaceCwd: string, generation: number): void {
  const state = useStore.getState();
  if (!state.workspaceLoading || !state.backendStatus.ready) return;
  if (state.messageRefreshGeneration !== generation) return;
  if (normalizeWorkspaceKey(state.workspaceCwd) !== normalizeWorkspaceKey(workspaceCwd)) return;
  useStore.setState({ workspaceLoading: false });
}

function normalizeWorkspaceKey(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function appendUniqueSessions(current: SessionInfo[], incoming: SessionInfo[]): SessionInfo[] {
  const seenPaths = new Set(current.map((session) => session.path));
  return [...current, ...incoming.filter((session) => !seenPaths.has(session.path))];
}

async function loadSessionPage(query: string, offset: number, append: boolean): Promise<void> {
  const requestId = ++sessionListRequestId;
  useStore.setState((state) => ({
    sessionsQuery: query,
    sessionsLoading: true,
    sessionsError: null,
    ...(!append && state.sessionsQuery !== query
      ? {
          sessions: [],
          sessionsTotal: 0,
          sessionsHasMore: false,
          sessionsNextOffset: null,
        }
      : {}),
  }));

  try {
    const page = await api.getSessions({ all: true, offset, limit: 200, query });
    const state = useStore.getState();
    if (requestId !== sessionListRequestId) return;
    if (state.sessionsQuery !== query) {
      useStore.setState({ sessionsLoading: false });
      return;
    }

    const sessions = append ? appendUniqueSessions(state.sessions, page.sessions) : page.sessions;
    useStore.setState({
      sessions,
      sessionsTotal: Math.max(page.total, sessions.length),
      sessionsHasMore: page.hasMore,
      sessionsNextOffset: page.nextOffset,
      sessionsLoading: false,
      sessionsError: null,
    });
  } catch (error) {
    if (requestId !== sessionListRequestId) return;
    const message = error instanceof Error && error.message.trim()
      ? error.message
      : "Could not load threads";
    useStore.setState({ sessionsLoading: false, sessionsError: message });
  }
}

async function refreshWorkspaceGitStatus(): Promise<void> {
  const requestId = ++gitStatusRequestId;
  useStore.setState({ workspaceGitStatusLoading: true });
  try {
    const status = await api.getWorkspaceGitStatus();
    if (requestId !== gitStatusRequestId) return;
    if (useStore.getState().workspaceCwd !== status.cwd) {
      useStore.setState({ workspaceGitStatusLoading: false });
      return;
    }
    useStore.setState({ workspaceGitStatus: status, workspaceGitStatusLoading: false });
  } catch {
    if (requestId !== gitStatusRequestId) return;
    useStore.setState({ workspaceGitStatus: null, workspaceGitStatusLoading: false });
  }
}

// Lightweight refresh for high-frequency streaming events (message_end): pulls
// only session state + stats, avoiding the 7-way fan-out of refreshState().
// Low-frequency data (models, custom models, commands, sessions) is refreshed
// separately on agent_end or explicit user actions.
async function refreshSessionState(): Promise<void> {
  const requestId = ++stateRefreshRequestId;
  const apiRef = api.getApi();
  if (!apiRef) return;

  const generation = useStore.getState().messageRefreshGeneration;
  const workspaceCwd = useStore.getState().workspaceCwd;

  try {
    const [session, messages, stats] = await Promise.all([
      api.getState(),
      api.getMessages(),
      api.getSessionStats().catch(() => undefined),
    ]);

    if (requestId !== stateRefreshRequestId) return;
    const current = useStore.getState();
    const decision = shouldApplyMessageRefresh(
      {
        workspaceCwd: current.workspaceCwd,
        generation: current.messageRefreshGeneration,
        isStreaming: current.isStreaming,
        messageCount: current.messages.length,
        activeMessageIndex: current.activeMessageIndex,
      },
      {
        workspaceCwd,
        generation,
        messageCount: messages.length,
      },
    );

    if (!decision.apply) {
      if (
        decision.reason !== "streaming-shrink" ||
        normalizeWorkspaceKey(current.workspaceCwd) !== normalizeWorkspaceKey(workspaceCwd)
      ) return;
      useStore.setState({
        session,
        stats,
        isStreaming: current.isStreaming || Boolean(session?.isStreaming),
      });
      latestAppliedStateRefreshRequestId = requestId;
      return;
    }

    const messageState = reconcileMessageSnapshot(
      { messages: current.messages, activeMessageIndex: current.activeMessageIndex },
      messages,
      current.isStreaming || Boolean(session?.isStreaming),
    );
    latestAppliedStateRefreshRequestId = requestId;
    useStore.setState({
      session,
      ...messageState,
      stats,
      isStreaming: current.isStreaming || Boolean(session?.isStreaming),
    });
  } catch {
    // A lightweight refresh must not release the full-refresh loading hold.
    // The next full refresh or backend status transition owns that boundary.
  }
}
