import { create } from "zustand";
import type {
  AuthStatus,
  BackendEvent,
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
} from "../ipc/types";
import * as api from "../ipc/api";
import { type MessageEventType, reduceMessageEvent } from "./messageCursor";

export type Theme = "light" | "dark" | "system";
export type SettingsRoute =
  | null
  | "models-providers"
  | "custom-providers"
  | "account"
  | "agent-general"
  | "appearance"
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

  // Models
  models: Model[];
  customModelsConfig: CustomModelsConfig | null;
  authStatuses: Record<string, AuthStatus>;

  // Commands
  commands: SlashCommand[];

  // Workspace
  workspaceCwd: string;
  workspaceFiles: string[];

  // UI state
  isStreaming: boolean;
  activeTool: string | null;
  extensionUIRequests: ExtensionUIRequestEvent[];

  // Streaming cursor: index of the message opened by the current message_start,
  // or null when no message is actively streaming. Message events carry no
  // stable top-level id, so this deterministic cursor is the source of truth for
  // which message message_update mutates.
  activeMessageIndex: number | null;

  // Theme & App
  theme: Theme;
  appInfo: AppInfo | null;
  settingsRoute: SettingsRoute;

  // Actions
  updateBackendStatus: (status: BackendStatus) => void;
  addLog: (entry: LogEntry) => void;
  setStreaming: (streaming: boolean) => void;
  setActiveTool: (tool: string | null) => void;
  upsertMessage: (message: Message, eventType: MessageEventType) => void;
  addExtensionUIRequest: (request: ExtensionUIRequestEvent) => void;
  removeExtensionUIRequest: (id: string) => void;
  setTheme: (theme: Theme) => void;
  openSettings: (route: SettingsRoute) => void;
  closeSettings: () => void;
  refresh: () => void;
  refreshSession: () => void;
  initialize: () => void;
}

const MAX_LOGS = 200;
const THEME_STORAGE_KEY = "pi-studio-theme";

function loadSavedTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {}
  return "system";
}

function applyThemeToDocument(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
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

  models: [],
  customModelsConfig: null,
  authStatuses: {},

  commands: [],

  workspaceCwd: "",
  workspaceFiles: [],

  isStreaming: false,
  activeTool: null,
  extensionUIRequests: [],
  activeMessageIndex: null,

  theme: loadSavedTheme(),
  appInfo: null,
  settingsRoute: null,

  updateBackendStatus(status) {
    set({ backendStatus: status });
    if (status.ready && !get().session) {
      get().refresh();
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

  setActiveTool(tool) {
    set({ activeTool: tool });
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
    set({ theme });
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch {}
    applyThemeToDocument(theme);
  },

  openSettings(route) {
    set({ settingsRoute: route });
  },

  closeSettings() {
    set({ settingsRoute: null });
  },

  refresh() {
    void refreshState();
  },

  refreshSession() {
    void refreshSessionState();
  },

  initialize() {
    applyThemeToDocument(get().theme);

    api.getBackendStatus().then((status) => {
      set({ backendStatus: status });
      if (status.ready) {
        get().refresh();
      }
    }).catch(() => {});

    api.getWorkspace().then(({ cwd }) => {
      set({ workspaceCwd: cwd });
    }).catch(() => {});

    api.getAppInfo().then((info) => {
      set({ appInfo: info });
    }).catch(() => {});
  },
}));

async function refreshState(): Promise<void> {
  const apiRef = api.getApi();
  if (!apiRef) return;

  try {
    const [session, messages, models, customModels, stats, commands, sessions] = await Promise.all([
      api.getState(),
      api.getMessages(),
      api.getAvailableModels().catch(() => [] as Model[]),
      api.getCustomModels().catch(() => null),
      api.getSessionStats().catch(() => undefined),
      api.getCommands().catch(() => [] as SlashCommand[]),
      api.getSessions().catch(() => [] as SessionInfo[]),
    ]);

    const customProviderIds = Object.keys(customModels?.providers ?? {});
    const authStatuses =
      customProviderIds.length > 0
        ? await api.getAuthStatus(customProviderIds).catch(() => ({}) as Record<string, AuthStatus>)
        : {} as Record<string, AuthStatus>;

    useStore.setState({
      session,
      messages,
      models,
      customModelsConfig: customModels,
      stats,
      commands,
      sessions,
      authStatuses,
      isStreaming: Boolean(session?.isStreaming),
    });
  } catch {
    // Backend may have disconnected; status events will handle reconnect
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
