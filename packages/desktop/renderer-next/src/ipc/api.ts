import type {
  AuthStatus,
  BackendCommand,
  BackendSendCommand,
  BackendStatus,
  CustomModelApi,
  CustomModelsConfig,
  LogEntry,
  Message,
  Model,
  QueueMode,
  SessionInfo,
  SessionState,
  SessionStats,
  SlashCommand,
  ThinkingLevel,
} from "./types";

export interface PiDesktopApi {
  request(command: BackendCommand): Promise<unknown>;
  send(command: BackendSendCommand): Promise<void>;
  getBackendStatus(): Promise<BackendStatus>;
  restartBackend(): Promise<void>;
  chooseWorkspace(): Promise<{ cwd: string; changed: boolean }>;
  openWorkspace(cwd: string): Promise<{ cwd: string; changed: boolean }>;
  getWorkspace(): Promise<{ cwd: string }>;
  listWorkspaceFiles(query?: string): Promise<{ files: string[] }>;
  openExternal(url: string): Promise<void>;
  fetchProviderModels(params: {
    baseUrl: string;
    apiKey?: string;
    api: CustomModelApi;
  }): Promise<{ models: { id: string; name?: string }[] }>;
  writeClipboardText(text: string): Promise<void>;
  getAppInfo(): Promise<{ name: string; version: string }>;
  checkForUpdates(): Promise<unknown>;
  saveDiagnostics(diagnostics: unknown): Promise<{ saved: boolean; path?: string }>;
  saveModelBackup(backup: unknown): Promise<{ saved: boolean; path?: string }>;
  openModelBackup(): Promise<{ opened: boolean; backup?: unknown }>;
  onEvent(listener: (payload: unknown) => void): () => void;
  onStatus(listener: (payload: Record<string, unknown>) => void): () => void;
  onLog(listener: (payload: LogEntry) => void): () => void;
}

declare global {
  interface Window {
    piDesktop?: PiDesktopApi;
  }
}

function getApi(): PiDesktopApi | undefined {
  return window.piDesktop;
}

function requireApi(): PiDesktopApi {
  const api = getApi();
  if (!api) throw new Error("piDesktop API not available (not running in Electron)");
  return api;
}

// --- State ---

export async function getState(): Promise<SessionState> {
  return (await requireApi().request({ type: "get_state" })) as SessionState;
}

export async function getMessages(): Promise<Message[]> {
  const result = (await requireApi().request({ type: "get_messages" })) as { messages: Message[] };
  return result.messages ?? [];
}

// --- Models ---

export async function getAvailableModels(): Promise<Model[]> {
  const result = (await requireApi().request({ type: "get_available_models" })) as { models: Model[] };
  return result.models ?? [];
}

export async function getCustomModels(): Promise<CustomModelsConfig> {
  return (await requireApi().request({ type: "get_custom_models" })) as CustomModelsConfig;
}

export async function setModel(provider: string, modelId: string): Promise<void> {
  await requireApi().request({ type: "set_model", provider, modelId });
}

export async function cycleModel(): Promise<void> {
  await requireApi().request({ type: "cycle_model" });
}

export async function getAuthStatus(providers: string[]): Promise<Record<string, AuthStatus>> {
  const result = (await requireApi().request({ type: "get_auth_status", providers })) as {
    providers: Record<string, AuthStatus>;
  };
  return result.providers ?? {};
}

export async function setApiKey(provider: string, apiKey: string): Promise<void> {
  await requireApi().request({ type: "set_api_key", provider, apiKey });
}

export async function removeApiKey(provider: string): Promise<void> {
  await requireApi().request({ type: "remove_api_key", provider });
}

export async function testModel(provider: string, modelId: string): Promise<unknown> {
  return requireApi().request({ type: "test_model", provider, modelId });
}

export async function testCustomModel(params: {
  provider: string;
  baseUrl: string;
  api: CustomModelApi;
  apiKey?: string;
  headers?: Record<string, string>;
  modelId: string;
  useStoredAuthProvider?: string;
  preserveHeadersFromProvider?: string;
}): Promise<unknown> {
  return requireApi().request({ type: "test_custom_model", ...params });
}

export async function upsertCustomModel(params: {
  provider: string;
  baseUrl: string;
  api: CustomModelApi;
  apiKey?: string;
  headers?: Record<string, string>;
  replaceModelId?: string;
  model: {
    id: string;
    name?: string;
    reasoning?: boolean;
    input?: ("text" | "image")[];
    contextWindow?: number;
    maxTokens?: number;
  };
}): Promise<void> {
  await requireApi().request({ type: "upsert_custom_model", ...params });
}

export async function removeCustomModel(provider: string, modelId: string, removeAuthWhenEmpty?: boolean): Promise<void> {
  await requireApi().request({ type: "remove_custom_model", provider, modelId, removeAuthWhenEmpty });
}

export async function replaceCustomModels(providers: Record<string, unknown>): Promise<void> {
  await requireApi().request({ type: "replace_custom_models", providers });
}

// --- Thinking ---

export async function setThinkingLevel(level: ThinkingLevel): Promise<void> {
  await requireApi().request({ type: "set_thinking_level", level });
}

export async function cycleThinkingLevel(): Promise<void> {
  await requireApi().request({ type: "cycle_thinking_level" });
}

// --- Queue modes ---

export async function setSteeringMode(mode: QueueMode): Promise<void> {
  await requireApi().request({ type: "set_steering_mode", mode });
}

export async function setFollowUpMode(mode: QueueMode): Promise<void> {
  await requireApi().request({ type: "set_follow_up_mode", mode });
}

// --- Compaction & retry ---

export async function compact(customInstructions?: string): Promise<void> {
  await requireApi().request({ type: "compact", customInstructions });
}

export async function setAutoCompaction(enabled: boolean): Promise<void> {
  await requireApi().request({ type: "set_auto_compaction", enabled });
}

export async function setAutoRetry(enabled: boolean): Promise<void> {
  await requireApi().request({ type: "set_auto_retry", enabled });
}

export async function abortRetry(): Promise<void> {
  await requireApi().request({ type: "abort_retry" });
}

// --- Sessions ---

export async function getSessionStats(): Promise<SessionStats | undefined> {
  return (await requireApi().request({ type: "get_session_stats" })) as SessionStats | undefined;
}

export async function getCommands(): Promise<SlashCommand[]> {
  const result = (await requireApi().request({ type: "get_commands" })) as { commands: SlashCommand[] };
  return result.commands ?? [];
}

export async function getSessions(limit = 48): Promise<SessionInfo[]> {
  const result = (await requireApi().request({ type: "get_sessions", limit })) as { sessions: SessionInfo[] };
  return result.sessions ?? [];
}

export async function setSessionName(name: string): Promise<void> {
  await requireApi().request({ type: "set_session_name", name });
}

export async function exportHtml(outputPath?: string): Promise<unknown> {
  return requireApi().request({ type: "export_html", outputPath });
}

export async function forkSession(entryId: string): Promise<void> {
  await requireApi().request({ type: "fork", entryId });
}

export async function cloneSession(): Promise<void> {
  await requireApi().request({ type: "clone" });
}

// --- Prompting ---

export async function sendPrompt(message: string): Promise<void> {
  await requireApi().request({ type: "prompt", message });
}

export async function steer(message: string): Promise<void> {
  await requireApi().request({ type: "steer", message });
}

export async function followUp(message: string): Promise<void> {
  await requireApi().request({ type: "follow_up", message });
}

export async function abort(): Promise<void> {
  await requireApi().request({ type: "abort" });
}

export async function newSession(): Promise<void> {
  await requireApi().request({ type: "new_session" });
}

export async function switchSession(sessionPath: string): Promise<void> {
  await requireApi().request({ type: "switch_session", sessionPath });
}

// --- Bash ---

export async function bash(command: string, excludeFromContext?: boolean): Promise<unknown> {
  return requireApi().request({ type: "bash", command, excludeFromContext });
}

export async function abortBash(): Promise<void> {
  await requireApi().request({ type: "abort_bash" });
}

// --- Fire-and-forget ---

export async function sendExtensionUIResponse(id: string, response: Record<string, unknown>): Promise<void> {
  await requireApi().send({ type: "extension_ui_response", id, ...response });
}

// --- Extension flags (e.g. permission mode) ---

export async function setExtensionFlag(name: string, value: boolean | string): Promise<void> {
  await requireApi().request({ type: "set_extension_flag", name, value });
}

// --- Desktop-level APIs (not routed through backend) ---

export async function getBackendStatus(): Promise<BackendStatus> {
  return requireApi().getBackendStatus();
}

export async function restartBackend(): Promise<void> {
  await requireApi().restartBackend();
}

export async function chooseWorkspace(): Promise<{ cwd: string; changed: boolean }> {
  return requireApi().chooseWorkspace();
}

export async function openWorkspace(cwd: string): Promise<{ cwd: string; changed: boolean }> {
  return requireApi().openWorkspace(cwd);
}

export async function getWorkspace(): Promise<{ cwd: string }> {
  return requireApi().getWorkspace();
}

export async function listWorkspaceFiles(query?: string): Promise<string[]> {
  const result = await requireApi().listWorkspaceFiles(query);
  return result.files ?? [];
}

export async function openExternal(url: string): Promise<void> {
  await requireApi().openExternal(url);
}

export async function fetchProviderModels(params: {
  baseUrl: string;
  apiKey?: string;
  api: CustomModelApi;
}): Promise<{ models: { id: string; name?: string }[] }> {
  return requireApi().fetchProviderModels(params);
}

export async function writeClipboardText(text: string): Promise<void> {
  await requireApi().writeClipboardText(text);
}

export async function getAppInfo(): Promise<{ name: string; version: string }> {
  return requireApi().getAppInfo();
}

export async function checkForUpdates(): Promise<unknown> {
  return requireApi().checkForUpdates();
}

export async function saveDiagnostics(diagnostics: unknown): Promise<{ saved: boolean; path?: string }> {
  return requireApi().saveDiagnostics(diagnostics);
}

export async function saveModelBackup(backup: unknown): Promise<{ saved: boolean; path?: string }> {
  return requireApi().saveModelBackup(backup);
}

export async function openModelBackup(): Promise<{ opened: boolean; backup?: unknown }> {
  return requireApi().openModelBackup();
}

// --- Event subscription ---

export function onEvent(listener: (payload: unknown) => void): () => void {
  const api = getApi();
  if (!api) return () => {};
  return api.onEvent(listener);
}

export function onStatus(listener: (payload: Record<string, unknown>) => void): () => void {
  const api = getApi();
  if (!api) return () => {};
  return api.onStatus(listener);
}

export function onLog(listener: (payload: LogEntry) => void): () => void {
  const api = getApi();
  if (!api) return () => {};
  return api.onLog(listener);
}

export { getApi };
