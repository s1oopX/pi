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
  GitDiffSectionName,
  GitFileDiff,
  GitHunkAction,
  GitHunkResult,
  GitPrContext,
  GitPrResult,
  GitPushResult,
  GitSwitchResult,
  ImageContent,
  LogEntry,
  Message,
  MirrorApplyResult,
  MirrorManager,
  MirrorStatusResult,
  Model,
  ProjectTrustEntries,
  ProjectTrustEntryUpdate,
  QueueMode,
  ResourcesData,
  SessionListPage,
  SessionState,
  SessionStats,
  SessionTreeData,
  SlashCommand,
  ThinkingLevel,
  WorkspaceFilePreview,
  WorkspaceGitStatus,
} from "./types";

export interface PiDesktopApi {
  request(command: BackendCommand, taskId?: string): Promise<unknown>;
  send(command: BackendSendCommand, taskId?: string): Promise<void>;
  getBackendStatus(taskId?: string): Promise<BackendStatus>;
  getPendingExtensionUIRequests?: (taskId?: string) => Promise<ExtensionUIRequestEvent[]>;
  createTask?: (cwd: string) => Promise<TaskSnapshot>;
  listTasks?: () => Promise<{ tasks: TaskSnapshot[]; maxTasks?: number }>;
  stopTask?: (taskId: string) => Promise<{ stopped: boolean; taskId: string; worktreeRemoved?: boolean; worktreeKeptReason?: string }>;
  pickTaskFolder?: () => Promise<{ canceled: boolean; cwd?: string }>;
  notifyActiveTask?: (taskId: string) => void;
  getTaskSettings?: () => Promise<TaskPoolSettings>;
  configureTasks?: (settings: Partial<TaskPoolSettings>) => Promise<TaskPoolSettings>;
  onTaskChanged?: (listener: (payload: TaskChangedEvent) => void) => () => void;
  listAutomations?: () => Promise<{ automations: AutomationRecord[] }>;
  createAutomation?: (input: AutomationInput, taskId?: string) => Promise<AutomationRecord>;
  updateAutomation?: (id: string, input: AutomationInput) => Promise<AutomationRecord>;
  setAutomationStatus?: (id: string, status: AutomationStatus) => Promise<AutomationRecord>;
  deleteAutomation?: (id: string) => Promise<AutomationRecord>;
  runAutomationNow?: (id: string) => Promise<AutomationRecord>;
  updateAutomationRun?: (automationId: string, runId: string, action: AutomationRunAction) => Promise<AutomationRecord>;
  openAutomationRun?: (automationId: string, runId: string) => Promise<{ cancelled: boolean; cwd: string; taskId?: string }>;
  onAutomationsChanged?: (listener: (payload: AutomationsChangedEvent) => void) => () => void;
  listWorktreeLeftovers?: () => Promise<{ leftovers: WorktreeLeftover[] }>;
  deleteWorktreeLeftover?: (targetPath: string) => Promise<{ deleted: boolean }>;
  restartBackend(): Promise<void>;
  chooseWorkspace(): Promise<{ cwd: string; changed: boolean }>;
  openWorkspace(cwd: string): Promise<{ cwd: string; changed: boolean }>;
  createProject?(args: { template: string; parentDir: string; projectName: string }): Promise<{ created: boolean; path: string }>;
  getMirrorStatus?(): Promise<MirrorStatusResult>;
  setMirrorSource?(args: { manager: string; sourceId: string }): Promise<MirrorApplyResult>;
  getWorkspace(): Promise<{ cwd: string; taskCwd: string }>;
  getWorkspaceGitStatus(taskId?: string): Promise<WorkspaceGitStatus>;
  getGitChanges(taskId?: string): Promise<GitChanges>;
  commitAllGitChanges(message: string, taskId?: string): Promise<{ committed: boolean; summary: string }>;
  getGitFileDiff?: (filePath: string, taskId?: string) => Promise<GitFileDiff>;
  applyGitHunk?: (
    params: {
      filePath: string;
      section: GitDiffSectionName;
      action: GitHunkAction;
      hunkIndex: number;
      patchHash: string;
    },
    taskId?: string,
  ) => Promise<GitHunkResult>;
  restoreGitFile?: (
    filePath: string,
    taskId?: string,
  ) => Promise<{ restored: boolean; untracked: boolean; trashed: boolean }>;
  getGitBranches(taskId?: string): Promise<GitBranches>;
  pushGitBranch(taskId?: string): Promise<GitPushResult>;
  switchGitBranch(name: string, options?: { create?: boolean }, taskId?: string): Promise<GitSwitchResult>;
  getGitPrContext(taskId?: string): Promise<GitPrContext>;
  createGitPullRequest(params: { title: string; body: string; base: string }, taskId?: string): Promise<GitPrResult>;
  listWorkspaceFiles(query?: string, taskId?: string): Promise<{ files: string[] }>;
  openWorkspaceLocation(cwd?: string): Promise<{ opened: boolean }>;
  revealWorkspacePath(
    targetPath: string,
    taskId?: string,
  ): Promise<{ revealed: boolean; path: string; insideWorkspace: boolean }>;
  openWorkspacePath(targetPath: string, taskId?: string): Promise<{ opened: boolean; path: string }>;
  readWorkspaceFile(targetPath: string, taskId?: string): Promise<WorkspaceFilePreview>;
  revealSessionFile(sessionPath: string): Promise<{ revealed: boolean }>;
  trashSessionFile(sessionPath: string): Promise<{ trashed: boolean }>;
  exportSessionFile(sessionPath: string): Promise<{ exported: boolean; path?: string }>;
  importSessionFile(): Promise<{ imported: boolean; path?: string }>;
  openExternal(url: string): Promise<void>;
  getDroppedFilePath?: (file: File) => string | null;
  fetchProviderModels(params: {
    baseUrl: string;
    apiKey?: string;
    api: CustomModelApi;
  }): Promise<{ models: { id: string; name?: string }[] }>;
  writeClipboardText(text: string): Promise<void>;
  getAppInfo(): Promise<{ name: string; version: string }>;
  getChangelog?: () => Promise<{ markdown: string }>;
  checkForUpdates(): Promise<unknown>;
  saveDiagnostics(diagnostics: unknown): Promise<{ saved: boolean; path?: string }>;
  openLogsFolder?: () => Promise<{ opened: boolean }>;
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

// --- Active-task routing (parallel tasks M2) ---
// Backend traffic implicitly targets the active task so the dozens of
// call sites below stay unchanged. undefined routes to the primary.

let activeBackendTaskId: string | undefined;

export function setActiveBackendTask(taskId: string | undefined): void {
  activeBackendTaskId = taskId;
  // The main process protects the viewed task from idle reaping.
  getApi()?.notifyActiveTask?.(taskId ?? "main");
}

export function getActiveBackendTask(): string | undefined {
  return activeBackendTaskId;
}

function backendRequest(command: BackendCommand): Promise<unknown> {
  return requireApi().request(command, activeBackendTaskId);
}

export interface TaskSnapshot {
  taskId: string;
  cwd: string;
  isPrimary: boolean;
  ready: boolean;
  starting: boolean;
  /** Worktree tasks carry the branch they run on and the repo they came from. */
  branch?: string;
  sourceRepo?: string;
}

export async function createTask(cwd: string): Promise<TaskSnapshot> {
  const api = requireApi();
  if (!api.createTask) throw new Error("Parallel tasks need a newer Pi Studio build");
  return api.createTask(cwd);
}

export interface TaskPoolSettings {
  maxTasks: number;
  idleMinutes: number;
}

export interface TaskChangedEvent {
  taskId: string;
  reason: string;
  worktreeRemoved?: boolean;
  worktreeKeptReason?: string;
}

export type AutomationStatus = "active" | "paused";
export type AutomationRunStatus = "running" | "success" | "error";
export type AutomationNotificationPolicy = "all" | "failures";
export type AutomationRunAction = "read" | "unread" | "archive" | "restore";
export type AutomationKind = "cron" | "heartbeat";
export type AutomationDestination = "local" | "worktree";

export interface AutomationModel {
  provider: string;
  id: string;
}

export interface AutomationThread {
  sessionId: string;
  sessionFile: string;
  cwd: string;
  sessionName?: string;
}

export interface AutomationWorktree {
  path: string;
  branch: string;
}

export interface AutomationRun {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: AutomationRunStatus;
  sessionId?: string;
  sessionFile?: string;
  error?: string;
  readAt?: string;
  archivedAt?: string;
}

export interface AutomationRecord {
  id: string;
  name: string;
  prompt: string;
  cwd: string;
  rrule: string;
  kind: AutomationKind;
  destination: AutomationDestination;
  status: AutomationStatus;
  notificationPolicy: AutomationNotificationPolicy;
  model?: AutomationModel;
  reasoningEffort?: ThinkingLevel;
  thread?: AutomationThread;
  worktree?: AutomationWorktree;
  worktreeCleanup?: { removed: boolean; reason?: string };
  createdAt: string;
  updatedAt: string;
  nextRunAt: string | null;
  lastRunAt?: string;
  lastRunStatus?: AutomationRunStatus;
  lastError?: string;
  runs: AutomationRun[];
}

export interface AutomationInput {
  name: string;
  prompt: string;
  cwd: string;
  rrule: string;
  kind?: AutomationKind;
  destination?: AutomationDestination;
  status?: AutomationStatus;
  notificationPolicy?: AutomationNotificationPolicy;
  model?: AutomationModel;
  reasoningEffort?: ThinkingLevel;
}

export interface AutomationsChangedEvent {
  automations: AutomationRecord[];
}

export async function listTasks(): Promise<{ tasks: TaskSnapshot[]; maxTasks?: number }> {
  const api = getApi();
  if (!api?.listTasks) return { tasks: [] };
  const result = await api.listTasks();
  return { tasks: result.tasks ?? [], maxTasks: (result as { maxTasks?: number }).maxTasks };
}

export async function getTaskSettings(): Promise<TaskPoolSettings | null> {
  const api = getApi();
  if (!api?.getTaskSettings) return null;
  return api.getTaskSettings();
}

export async function configureTasks(settings: Partial<TaskPoolSettings>): Promise<TaskPoolSettings> {
  const api = requireApi();
  if (!api.configureTasks) throw new Error("Parallel tasks need a newer Pi Studio build");
  return api.configureTasks(settings);
}

export function onTaskChanged(listener: (payload: TaskChangedEvent) => void): () => void {
  const api = getApi();
  if (!api?.onTaskChanged) return () => {};
  return api.onTaskChanged(listener);
}

export interface WorktreeLeftover {
  path: string;
  sourceRepo: string | null;
  dirty: boolean | null;
}

export async function listWorktreeLeftovers(): Promise<WorktreeLeftover[]> {
  const api = getApi();
  if (!api?.listWorktreeLeftovers) return [];
  const result = await api.listWorktreeLeftovers();
  return result.leftovers ?? [];
}

export async function deleteWorktreeLeftover(targetPath: string): Promise<void> {
  const api = requireApi();
  if (!api.deleteWorktreeLeftover) throw new Error("Worktree cleanup needs a newer Pi Studio build");
  await api.deleteWorktreeLeftover(targetPath);
}

export async function stopTask(
  taskId: string,
): Promise<{ stopped: boolean; taskId: string; worktreeRemoved?: boolean; worktreeKeptReason?: string }> {
  const api = requireApi();
  if (!api.stopTask) throw new Error("Parallel tasks need a newer Pi Studio build");
  return api.stopTask(taskId);
}

export async function pickTaskFolder(): Promise<{ canceled: boolean; cwd?: string }> {
  const api = requireApi();
  if (!api.pickTaskFolder) throw new Error("Parallel tasks need a newer Pi Studio build");
  return api.pickTaskFolder();
}

export async function listAutomations(): Promise<AutomationRecord[]> {
  const api = requireApi();
  if (!api.listAutomations) throw new Error("Automations need a newer Pi Studio build");
  const result = await api.listAutomations();
  return result.automations ?? [];
}

export async function createAutomation(input: AutomationInput): Promise<AutomationRecord> {
  const api = requireApi();
  if (!api.createAutomation) throw new Error("Automations need a newer Pi Studio build");
  return api.createAutomation(input, activeBackendTaskId);
}

export async function updateAutomation(id: string, input: AutomationInput): Promise<AutomationRecord> {
  const api = requireApi();
  if (!api.updateAutomation) throw new Error("Automations need a newer Pi Studio build");
  return api.updateAutomation(id, input);
}

export async function setAutomationStatus(id: string, status: AutomationStatus): Promise<AutomationRecord> {
  const api = requireApi();
  if (!api.setAutomationStatus) throw new Error("Automations need a newer Pi Studio build");
  return api.setAutomationStatus(id, status);
}

export async function deleteAutomation(id: string): Promise<AutomationRecord> {
  const api = requireApi();
  if (!api.deleteAutomation) throw new Error("Automations need a newer Pi Studio build");
  return api.deleteAutomation(id);
}

export async function runAutomationNow(id: string): Promise<AutomationRecord> {
  const api = requireApi();
  if (!api.runAutomationNow) throw new Error("Automations need a newer Pi Studio build");
  return api.runAutomationNow(id);
}

export async function updateAutomationRun(
  automationId: string,
  runId: string,
  action: AutomationRunAction,
): Promise<AutomationRecord> {
  const api = requireApi();
  if (!api.updateAutomationRun) throw new Error("Automation run triage needs a newer Pi Studio build");
  return api.updateAutomationRun(automationId, runId, action);
}

export async function openAutomationRun(
  automationId: string,
  runId: string,
): Promise<{ cancelled: boolean; cwd: string; taskId?: string }> {
  const api = requireApi();
  if (!api.openAutomationRun) throw new Error("Automation history needs a newer Pi Studio build");
  return api.openAutomationRun(automationId, runId);
}

export function onAutomationsChanged(listener: (payload: AutomationsChangedEvent) => void): () => void {
  const api = getApi();
  if (!api?.onAutomationsChanged) return () => {};
  return api.onAutomationsChanged(listener);
}

// --- State ---

export async function getState(): Promise<SessionState> {
  return (await backendRequest({ type: "get_state" })) as SessionState;
}

export async function getMessages(): Promise<Message[]> {
  const result = (await backendRequest({ type: "get_messages" })) as { messages: Message[] };
  return result.messages ?? [];
}

// --- Models ---

export async function getAvailableModels(): Promise<Model[]> {
  const result = (await backendRequest({ type: "get_available_models" })) as { models: Model[] };
  return result.models ?? [];
}

export async function getCustomModels(): Promise<CustomModelsConfig> {
  return (await backendRequest({ type: "get_custom_models" })) as CustomModelsConfig;
}

export async function setModel(provider: string, modelId: string): Promise<void> {
  await backendRequest({ type: "set_model", provider, modelId });
}

export async function cycleModel(): Promise<void> {
  await backendRequest({ type: "cycle_model" });
}

export async function getAuthStatus(providers?: string[]): Promise<Record<string, AuthStatus>> {
  const result = (await backendRequest({
    type: "get_auth_status",
    ...(providers ? { providers } : {}),
  })) as {
    providers: Record<string, AuthStatus>;
  };
  return result.providers ?? {};
}

export async function setApiKey(provider: string, apiKey: string): Promise<{ provider: string; status: AuthStatus }> {
  return (await backendRequest({ type: "set_api_key", provider, apiKey })) as {
    provider: string;
    status: AuthStatus;
  };
}

export async function removeApiKey(provider: string): Promise<{ provider: string; status: AuthStatus }> {
  return (await backendRequest({ type: "remove_api_key", provider })) as {
    provider: string;
    status: AuthStatus;
  };
}

export async function testModel(provider: string, modelId: string): Promise<unknown> {
  return backendRequest({ type: "test_model", provider, modelId });
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
  return backendRequest({ type: "test_custom_model", ...params });
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
  const result = (await backendRequest({ type: "fetch_provider_models", ...params })) as {
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
  await backendRequest({ type: "upsert_custom_model", ...params });
}

export async function removeCustomModel(provider: string, modelId: string, removeAuthWhenEmpty?: boolean): Promise<void> {
  await backendRequest({ type: "remove_custom_model", provider, modelId, removeAuthWhenEmpty });
}

export async function removeCustomProvider(provider: string, removeAuth?: boolean): Promise<void> {
  await backendRequest({ type: "remove_custom_provider", provider, removeAuth });
}

export async function replaceCustomModels(
  providers: Record<string, unknown>,
  options: { removeOrphanStoredAuth?: boolean } = {},
): Promise<void> {
  await backendRequest({ type: "replace_custom_models", providers, ...options });
}

// --- Thinking ---

export async function setThinkingLevel(level: ThinkingLevel): Promise<void> {
  await backendRequest({ type: "set_thinking_level", level });
}

export async function cycleThinkingLevel(): Promise<void> {
  await backendRequest({ type: "cycle_thinking_level" });
}

// --- Queue modes ---

export async function setSteeringMode(mode: QueueMode): Promise<void> {
  await backendRequest({ type: "set_steering_mode", mode });
}

export async function setFollowUpMode(mode: QueueMode): Promise<void> {
  await backendRequest({ type: "set_follow_up_mode", mode });
}

// --- Compaction & retry ---

export async function compact(customInstructions?: string): Promise<void> {
  await backendRequest({ type: "compact", customInstructions });
}

export async function setAutoCompaction(enabled: boolean): Promise<void> {
  await backendRequest({ type: "set_auto_compaction", enabled });
}

export async function setAutoRetry(enabled: boolean): Promise<void> {
  await backendRequest({ type: "set_auto_retry", enabled });
}

export async function abortRetry(): Promise<void> {
  await backendRequest({ type: "abort_retry" });
}

// --- Sessions ---

export async function getSessionStats(): Promise<SessionStats | undefined> {
  return (await backendRequest({ type: "get_session_stats" })) as SessionStats | undefined;
}

export async function getCommands(): Promise<SlashCommand[]> {
  const result = (await backendRequest({ type: "get_commands" })) as { commands: SlashCommand[] };
  return result.commands ?? [];
}

export type GetSessionsOptions = Omit<GetSessionsCommand, "type">;

export async function getSessions(options: GetSessionsOptions = {}): Promise<SessionListPage> {
  return (await backendRequest({ type: "get_sessions", ...options })) as SessionListPage;
}

export async function getResources(options: { reload?: boolean } = {}): Promise<ResourcesData> {
  return (await backendRequest({ type: "get_resources", ...options })) as ResourcesData;
}

export async function setSessionName(name: string): Promise<void> {
  await backendRequest({ type: "set_session_name", name });
}

export async function exportHtml(outputPath?: string): Promise<unknown> {
  return backendRequest({ type: "export_html", outputPath });
}

export async function forkSession(entryId: string): Promise<ForkResult> {
  return (await backendRequest({ type: "fork", entryId })) as ForkResult;
}

export async function cloneSession(): Promise<{ cancelled: boolean }> {
  return (await backendRequest({ type: "clone" })) as { cancelled: boolean };
}

export async function getForkMessages(): Promise<ForkMessage[]> {
  const result = (await backendRequest({ type: "get_fork_messages" })) as { messages: ForkMessage[] };
  return result.messages ?? [];
}

export async function getSessionTree(): Promise<SessionTreeData> {
  return (await backendRequest({ type: "get_tree" })) as SessionTreeData;
}

// --- Prompting ---

export async function sendPrompt(
  message: string,
  images?: ImageContent[],
  streamingBehavior?: "followUp" | "steer",
): Promise<void> {
  await backendRequest({ type: "prompt", message, images, streamingBehavior });
}

export async function steer(message: string, images?: ImageContent[]): Promise<void> {
  await backendRequest({ type: "steer", message, images });
}

export async function followUp(message: string, images?: ImageContent[]): Promise<void> {
  await backendRequest({ type: "follow_up", message, images });
}

export async function abort(): Promise<void> {
  await backendRequest({ type: "abort" });
}

export async function newSession(cwd?: string): Promise<{ cancelled: boolean; cwd: string }> {
  return (await backendRequest({ type: "new_session", cwd })) as { cancelled: boolean; cwd: string };
}

export async function switchSession(sessionPath: string): Promise<{ cancelled: boolean; cwd: string }> {
  return (await backendRequest({ type: "switch_session", sessionPath })) as { cancelled: boolean; cwd: string };
}

// --- Bash ---

export async function bash(command: string, excludeFromContext?: boolean, id?: string): Promise<unknown> {
  return backendRequest({ type: "bash", command, excludeFromContext, ...(id ? { id } : {}) });
}

export async function abortBash(executionId?: string): Promise<void> {
  await backendRequest({ type: "abort_bash", executionId });
}

// --- Fire-and-forget ---

export async function sendExtensionUIResponse(id: string, response: Record<string, unknown>): Promise<void> {
  await requireApi().send({ type: "extension_ui_response", id, ...response }, activeBackendTaskId);
}

// --- Extension flags (e.g. permission mode) ---

export async function setExtensionFlag(name: string, value: boolean | string): Promise<void> {
  await backendRequest({ type: "set_extension_flag", name, value });
}

// --- Project trust ---

export async function setProjectTrust(
  trusted: boolean,
): Promise<{ trusted: boolean; projectTrustRequired: boolean }> {
  return (await backendRequest({ type: "set_project_trust", trusted })) as {
    trusted: boolean;
    projectTrustRequired: boolean;
  };
}

export async function getProjectTrustEntries(): Promise<ProjectTrustEntries> {
  return (await backendRequest({ type: "get_project_trust_entries" })) as ProjectTrustEntries;
}

export async function setProjectTrustEntry(path: string, decision: boolean | null): Promise<ProjectTrustEntryUpdate> {
  return (await backendRequest({ type: "set_project_trust_entry", path, decision })) as ProjectTrustEntryUpdate;
}

// --- Desktop-level APIs (not routed through backend) ---

export async function getBackendStatus(): Promise<BackendStatus> {
  return requireApi().getBackendStatus(activeBackendTaskId);
}

export async function getPendingExtensionUIRequests(): Promise<ExtensionUIRequestEvent[]> {
  const api = getApi();
  if (!api?.getPendingExtensionUIRequests) return [];
  const requests = await api.getPendingExtensionUIRequests(activeBackendTaskId);
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

export async function createProject(args: { template: string; parentDir: string; projectName: string }): Promise<{ created: boolean; path: string }> {
  const api = requireApi();
  if (!api.createProject) throw new Error("Quick Start projects need a newer Pi Studio build");
  return api.createProject(args);
}

export async function getMirrorStatus(): Promise<MirrorStatusResult> {
  const api = requireApi();
  if (!api.getMirrorStatus) throw new Error("Mirror sources need a newer Pi Studio build");
  return api.getMirrorStatus();
}

export async function setMirrorSource(manager: MirrorManager, sourceId: string): Promise<MirrorApplyResult> {
  const api = requireApi();
  if (!api.setMirrorSource) throw new Error("Mirror sources need a newer Pi Studio build");
  return api.setMirrorSource({ manager, sourceId });
}

export async function getWorkspace(): Promise<{ cwd: string; taskCwd: string }> {
  return requireApi().getWorkspace();
}

export async function getWorkspaceGitStatus(): Promise<WorkspaceGitStatus> {
  return requireApi().getWorkspaceGitStatus(activeBackendTaskId);
}

export async function getGitChanges(): Promise<GitChanges> {
  return requireApi().getGitChanges(activeBackendTaskId);
}

export async function commitAllGitChanges(message: string): Promise<{ committed: boolean; summary: string }> {
  return requireApi().commitAllGitChanges(message, activeBackendTaskId);
}

export async function getGitFileDiff(filePath: string): Promise<GitFileDiff> {
  const api = requireApi();
  if (!api.getGitFileDiff) throw new Error("File diffs need a newer Pi Studio build");
  return api.getGitFileDiff(filePath, activeBackendTaskId);
}

export async function applyGitHunk(params: {
  filePath: string;
  section: GitDiffSectionName;
  action: GitHunkAction;
  hunkIndex: number;
  patchHash: string;
}): Promise<GitHunkResult> {
  const api = requireApi();
  if (!api.applyGitHunk) throw new Error("Hunk actions need a newer Pi Studio build");
  return api.applyGitHunk(params, activeBackendTaskId);
}

export async function restoreGitFile(
  filePath: string,
): Promise<{ restored: boolean; untracked: boolean; trashed: boolean }> {
  const api = requireApi();
  if (!api.restoreGitFile) throw new Error("File restore needs a newer Pi Studio build");
  return api.restoreGitFile(filePath, activeBackendTaskId);
}

export async function getGitBranches(): Promise<GitBranches> {
  return requireApi().getGitBranches(activeBackendTaskId);
}

export async function pushGitBranch(): Promise<GitPushResult> {
  return requireApi().pushGitBranch(activeBackendTaskId);
}

export async function switchGitBranch(name: string, options?: { create?: boolean }): Promise<GitSwitchResult> {
  return requireApi().switchGitBranch(name, options, activeBackendTaskId);
}

export async function getGitPrContext(): Promise<GitPrContext> {
  return requireApi().getGitPrContext(activeBackendTaskId);
}

export async function createGitPullRequest(params: { title: string; body: string; base: string }): Promise<GitPrResult> {
  return requireApi().createGitPullRequest(params, activeBackendTaskId);
}

export async function listWorkspaceFiles(query?: string): Promise<string[]> {
  const result = await requireApi().listWorkspaceFiles(query, activeBackendTaskId);
  return result.files ?? [];
}

export async function openWorkspaceLocation(cwd?: string): Promise<void> {
  await requireApi().openWorkspaceLocation(cwd);
}

export async function revealWorkspacePath(
  targetPath: string,
): Promise<{ revealed: boolean; path: string; insideWorkspace: boolean }> {
  return requireApi().revealWorkspacePath(targetPath, activeBackendTaskId);
}

export async function openWorkspacePath(targetPath: string): Promise<void> {
  await requireApi().openWorkspacePath(targetPath, activeBackendTaskId);
}

export async function readWorkspaceFile(targetPath: string): Promise<WorkspaceFilePreview> {
  return requireApi().readWorkspaceFile(targetPath, activeBackendTaskId);
}

export async function revealSessionFile(sessionPath: string): Promise<void> {
  await requireApi().revealSessionFile(sessionPath);
}

export async function trashSessionFile(sessionPath: string): Promise<void> {
  await requireApi().trashSessionFile(sessionPath);
}

export async function exportSessionFile(sessionPath: string): Promise<{ exported: boolean; path?: string }> {
  return requireApi().exportSessionFile(sessionPath);
}

export async function importSessionFile(): Promise<{ imported: boolean; path?: string }> {
  return requireApi().importSessionFile();
}

export function getDroppedFilePath(file: File): string | null {
  return getApi()?.getDroppedFilePath?.(file) ?? null;
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

export async function getChangelog(): Promise<string> {
  const api = requireApi();
  if (!api.getChangelog) throw new Error("The changelog needs a newer Pi Studio build");
  const result = await api.getChangelog();
  return result.markdown ?? "";
}

export async function checkForUpdates(): Promise<unknown> {
  return requireApi().checkForUpdates();
}

export async function saveDiagnostics(diagnostics: unknown): Promise<{ saved: boolean; path?: string }> {
  return requireApi().saveDiagnostics(diagnostics);
}

export async function openLogsFolder(): Promise<void> {
  const api = requireApi();
  if (!api.openLogsFolder) throw new Error("Log files need a newer Pi Studio build");
  await api.openLogsFolder();
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
