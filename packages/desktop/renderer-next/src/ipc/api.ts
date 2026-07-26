import type {
  AuthStatus,
  BackendCommand,
  BackendSendCommand,
  BackendStatus,
  CustomModelApi,
  CustomModelsConfig,
  ExtensionUIRequestEvent,
  ForkMessage,
  ForkResult,
  GetSessionsCommand,
  GitBranches,
  GitChanges,
  GitPushResult,
  GitSwitchResult,
  ImageContent,
  LogEntry,
  Message,
  Model,
  QueueMode,
  ResourcesData,
  SessionListPage,
  SessionState,
  SessionStats,
  SessionTreeData,
  SlashCommand,
  ThinkingLevel,
  WorkspaceGitStatus,
} from "./types";

export interface PiDesktopApi {
  request(command: BackendCommand): Promise<unknown>;
  send(command: BackendSendCommand): Promise<void>;
  getBackendStatus(): Promise<BackendStatus>;
  getPendingExtensionUIRequests?: () => Promise<ExtensionUIRequestEvent[]>;
  restartBackend(): Promise<void>;
  chooseWorkspace(): Promise<{ cwd: string; changed: boolean }>;
  openWorkspace(cwd: string): Promise<{ cwd: string; changed: boolean }>;
  getWorkspace(): Promise<{ cwd: string; taskCwd: string }>;
  getWorkspaceGitStatus(): Promise<WorkspaceGitStatus>;
  getGitChanges(): Promise<GitChanges>;
  commitAllGitChanges(message: string): Promise<{ committed: boolean; summary: string }>;
  getGitBranches(): Promise<GitBranches>;
  pushGitBranch(): Promise<GitPushResult>;
  switchGitBranch(name: string, options?: { create?: boolean }): Promise<GitSwitchResult>;
  listWorkspaceFiles(query?: string): Promise<{ files: string[] }>;
  openWorkspaceLocation(cwd?: string): Promise<{ opened: boolean }>;
  revealWorkspacePath(targetPath: string): Promise<{ revealed: boolean; path: string; insideWorkspace: boolean }>;
  revealSessionFile(sessionPath: string): Promise<{ revealed: boolean }>;
  trashSessionFile(sessionPath: string): Promise<{ trashed: boolean }>;
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

export async function getAuthStatus(providers?: string[]): Promise<Record<string, AuthStatus>> {
  const result = (await requireApi().request({
    type: "get_auth_status",
    ...(providers ? { providers } : {}),
  })) as {
    providers: Record<string, AuthStatus>;
  };
  return result.providers ?? {};
}

export async function setApiKey(provider: string, apiKey: string): Promise<{ provider: string; status: AuthStatus }> {
  return (await requireApi().request({ type: "set_api_key", provider, apiKey })) as {
    provider: string;
    status: AuthStatus;
  };
}

export async function removeApiKey(provider: string): Promise<{ provider: string; status: AuthStatus }> {
  return (await requireApi().request({ type: "remove_api_key", provider })) as {
    provider: string;
    status: AuthStatus;
  };
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
  proxyUrl?: string;
}): Promise<unknown> {
  return requireApi().request({ type: "test_custom_model", ...params });
}

export async function fetchProviderModels(params: {
  provider: string;
  baseUrl: string;
  api: CustomModelApi;
  apiKey?: string;
  headers?: Record<string, string>;
  useStoredAuthProvider?: string;
  preserveHeadersFromProvider?: string;
  proxyUrl?: string;
}): Promise<{ models: { id: string; name?: string }[] }> {
  const result = (await requireApi().request({ type: "fetch_provider_models", ...params })) as {
    models: { id: string; name?: string }[];
  };
  return { models: result.models ?? [] };
}

export async function upsertCustomModel(params: {
  provider: string;
  baseUrl: string;
  api: CustomModelApi;
  authKind?: "api_key" | "none";
  apiKey?: string;
  headers?: Record<string, string>;
  proxyUrl?: string;
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

export async function removeCustomProvider(provider: string, removeAuth?: boolean): Promise<void> {
  await requireApi().request({ type: "remove_custom_provider", provider, removeAuth });
}

export async function replaceCustomModels(
  providers: Record<string, unknown>,
  options: { removeOrphanStoredAuth?: boolean } = {},
): Promise<void> {
  await requireApi().request({ type: "replace_custom_models", providers, ...options });
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

export type GetSessionsOptions = Omit<GetSessionsCommand, "type">;

export async function getSessions(options: GetSessionsOptions = {}): Promise<SessionListPage> {
  return (await requireApi().request({ type: "get_sessions", ...options })) as SessionListPage;
}

export async function getResources(options: { reload?: boolean } = {}): Promise<ResourcesData> {
  return (await requireApi().request({ type: "get_resources", ...options })) as ResourcesData;
}

export async function setSessionName(name: string): Promise<void> {
  await requireApi().request({ type: "set_session_name", name });
}

export async function exportHtml(outputPath?: string): Promise<unknown> {
  return requireApi().request({ type: "export_html", outputPath });
}

export async function forkSession(entryId: string): Promise<ForkResult> {
  return (await requireApi().request({ type: "fork", entryId })) as ForkResult;
}

export async function cloneSession(): Promise<{ cancelled: boolean }> {
  return (await requireApi().request({ type: "clone" })) as { cancelled: boolean };
}

export async function getForkMessages(): Promise<ForkMessage[]> {
  const result = (await requireApi().request({ type: "get_fork_messages" })) as { messages: ForkMessage[] };
  return result.messages ?? [];
}

export async function getSessionTree(): Promise<SessionTreeData> {
  return (await requireApi().request({ type: "get_tree" })) as SessionTreeData;
}

// --- Prompting ---

export async function sendPrompt(
  message: string,
  images?: ImageContent[],
  streamingBehavior?: "followUp" | "steer",
): Promise<void> {
  await requireApi().request({ type: "prompt", message, images, streamingBehavior });
}

export async function steer(message: string, images?: ImageContent[]): Promise<void> {
  await requireApi().request({ type: "steer", message, images });
}

export async function followUp(message: string, images?: ImageContent[]): Promise<void> {
  await requireApi().request({ type: "follow_up", message, images });
}

export async function abort(): Promise<void> {
  await requireApi().request({ type: "abort" });
}

export async function newSession(cwd?: string): Promise<{ cancelled: boolean; cwd: string }> {
  return (await requireApi().request({ type: "new_session", cwd })) as { cancelled: boolean; cwd: string };
}

export async function switchSession(sessionPath: string): Promise<{ cancelled: boolean; cwd: string }> {
  return (await requireApi().request({ type: "switch_session", sessionPath })) as { cancelled: boolean; cwd: string };
}

// --- Bash ---

export async function bash(command: string, excludeFromContext?: boolean, id?: string): Promise<unknown> {
  return requireApi().request({ type: "bash", command, excludeFromContext, ...(id ? { id } : {}) });
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

// --- Project trust ---

export async function setProjectTrust(
  trusted: boolean,
): Promise<{ trusted: boolean; projectTrustRequired: boolean }> {
  return (await requireApi().request({ type: "set_project_trust", trusted })) as {
    trusted: boolean;
    projectTrustRequired: boolean;
  };
}

// --- Desktop-level APIs (not routed through backend) ---

export async function getBackendStatus(): Promise<BackendStatus> {
  return requireApi().getBackendStatus();
}

export async function getPendingExtensionUIRequests(): Promise<ExtensionUIRequestEvent[]> {
  const api = getApi();
  if (!api?.getPendingExtensionUIRequests) return [];
  const requests = await api.getPendingExtensionUIRequests();
  return Array.isArray(requests) ? requests : [];
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

export async function getWorkspace(): Promise<{ cwd: string; taskCwd: string }> {
  return requireApi().getWorkspace();
}

export async function getWorkspaceGitStatus(): Promise<WorkspaceGitStatus> {
  return requireApi().getWorkspaceGitStatus();
}

export async function getGitChanges(): Promise<GitChanges> {
  return requireApi().getGitChanges();
}

export async function commitAllGitChanges(message: string): Promise<{ committed: boolean; summary: string }> {
  return requireApi().commitAllGitChanges(message);
}

export async function getGitBranches(): Promise<GitBranches> {
  return requireApi().getGitBranches();
}

export async function pushGitBranch(): Promise<GitPushResult> {
  return requireApi().pushGitBranch();
}

export async function switchGitBranch(name: string, options?: { create?: boolean }): Promise<GitSwitchResult> {
  return requireApi().switchGitBranch(name, options);
}

export async function listWorkspaceFiles(query?: string): Promise<string[]> {
  const result = await requireApi().listWorkspaceFiles(query);
  return result.files ?? [];
}

export async function openWorkspaceLocation(cwd?: string): Promise<void> {
  await requireApi().openWorkspaceLocation(cwd);
}

export async function revealWorkspacePath(
  targetPath: string,
): Promise<{ revealed: boolean; path: string; insideWorkspace: boolean }> {
  return requireApi().revealWorkspacePath(targetPath);
}

export async function revealSessionFile(sessionPath: string): Promise<void> {
  await requireApi().revealSessionFile(sessionPath);
}

export async function trashSessionFile(sessionPath: string): Promise<void> {
  await requireApi().trashSessionFile(sessionPath);
}

export async function openExternal(url: string): Promise<void> {
  await requireApi().openExternal(url);
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
