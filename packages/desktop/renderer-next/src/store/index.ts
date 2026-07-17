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
import { type MessageEventType, reduceMessageEvent } from "./messageCursor";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<Theme, "system">;
export type PermissionMode = "full" | "auto" | "ask";
export type ToolExecutionPhase = "queued" | "running" | "done" | "error";

export interface ToolExecutionRecord {
  toolName: string;
  phase: ToolExecutionPhase;
}

export type ToolExecutionsByCallId = Record<string, ToolExecutionRecord>;

export interface ExtensionWidgetState {
  key: string;
  lines: string[];
  placement: ExtensionWidgetPlacement;
  order: number;
}

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

  // UI state
  isStreaming: boolean;
  activeTool: string | null;
  toolExecutionsByCallId: ToolExecutionsByCallId;
  extensionUIRequests: ExtensionUIRequestEvent[];
  extensionStatuses: Record<string, string>;
  extensionWidgets: ExtensionWidgetState[];
  extensionTitle: string | null;
  queuedSteering: string[];
  queuedFollowUp: string[];
  retryActivity: RetryActivity | null;
  compactionActivity: CompactionActivity | null;

  // Draft text pushed into the Composer from elsewhere (e.g. empty-state cards).
  // The Composer consumes it, prefills its local input, then clears it.
  composerDraft: string | null;

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

  // Actions
  updateBackendStatus: (status: BackendStatus) => void;
  addLog: (entry: LogEntry) => void;
  setStreaming: (streaming: boolean) => void;
  queueToolExecutions: (calls: readonly { callId: string; toolName: string }[]) => void;
  startToolExecution: (callId: string, toolName: string) => void;
  finishToolExecution: (callId: string, toolName: string, isError: boolean) => void;
  clearToolExecutions: () => void;
  upsertMessage: (message: Message, eventType: MessageEventType) => void;
  addExtensionUIRequest: (request: ExtensionUIRequestEvent) => void;
  removeExtensionUIRequest: (id: string) => void;
  setExtensionStatus: (key: string, text: string | undefined) => void;
  setExtensionWidget: (key: string, lines: string[] | undefined, placement: ExtensionWidgetPlacement) => void;
  setExtensionTitle: (title: string | null) => void;
  updateAgentActivity: (event: AgentActivityEvent) => void;
  setTheme: (theme: Theme) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  openSettings: (route: SettingsRoute) => void;
  closeSettings: () => void;
  setComposerDraft: (text: string | null) => void;
  resetForWorkspace: (cwd: string) => void;
  refreshWorkspaceGitStatus: () => void;
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

  theme: initialTheme,
  resolvedTheme: initialResolvedTheme,
  appInfo: null,
  settingsRoute: null,
  permissionMode: loadSavedPermissionMode(),

  updateBackendStatus(status) {
    const wasReady = get().backendStatus.ready;
    if (status.ready) {
      set({ backendStatus: status });
    } else {
      nextExtensionWidgetOrder = 0;
      if (typeof document !== "undefined") document.title = get().appInfo?.name ?? "Pi Studio";
      set({
        backendStatus: status,
        retryActivity: null,
        compactionActivity: null,
        extensionUIRequests: [],
        extensionStatuses: {},
        extensionWidgets: [],
        extensionTitle: null,
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
    set((s) => ({
      extensionUIRequests: [...s.extensionUIRequests, request],
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

  resetForWorkspace(cwd) {
    nextExtensionWidgetOrder = 0;
    if (typeof document !== "undefined") document.title = get().appInfo?.name ?? "Pi Studio";
    set({
      workspaceCwd: cwd,
      workspaceFiles: [],
      workspaceGitStatus: null,
      workspaceGitStatusLoading: false,
      session: null,
      messages: [],
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
    void refreshWorkspaceGitStatus();
    if (get().backendStatus.ready) get().refresh();
  },

  refreshWorkspaceGitStatus() {
    void refreshWorkspaceGitStatus();
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
  useStore.setState({ toolExecutionsByCallId: {}, activeTool: null });
  const apiRef = api.getApi();
  if (!apiRef) return;

  void loadSessionPage(useStore.getState().sessionsQuery, 0, false);

  try {
    const [session, messages, models, customModels, stats, commands] = await Promise.all([
      api.getState(),
      api.getMessages(),
      api.getAvailableModels().catch(() => [] as Model[]),
      api.getCustomModels().catch(() => null),
      api.getSessionStats().catch(() => undefined),
      api.getCommands().catch(() => [] as SlashCommand[]),
    ]);

    const authStatuses = await api.getAuthStatus().catch(() => ({}) as Record<string, AuthStatus>);

    useStore.setState({
      session,
      messages,
      models,
      customModelsConfig: customModels,
      stats,
      commands,
      authStatuses,
      isStreaming: Boolean(session?.isStreaming),
    });
    void refreshWorkspaceGitStatus();
  } catch {
    // Backend may have disconnected; status events will handle reconnect
  }
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
  const apiRef = api.getApi();
  if (!apiRef) return;

  try {
    const [session, messages, stats] = await Promise.all([
      api.getState(),
      api.getMessages(),
      api.getSessionStats().catch(() => undefined),
    ]);

    useStore.setState({
      session,
      messages,
      stats,
      isStreaming: Boolean(session?.isStreaming),
    });
  } catch {
    // Backend may have disconnected; status events will handle reconnect
  }
}
