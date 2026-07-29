// Shared type aliases.
//
// Domain types are re-exported from the backend's self-contained wire contract
// (rpc-desktop-contract.ts) so they cannot drift from what the backend actually
// serializes onto stdio. This is a type-only relative import; Vite erases it at
// runtime and the renderer's standalone tsc resolves it directly.

import type {
  RpcAgentMessageDTO,
  RpcAssistantContentBlockDTO,
  RpcAuthStatusDTO,
  RpcBackendEventDTO,
  RpcCustomModelsConfigDTO,
  RpcExtensionUIRequestClosedEventDTO,
  RpcExtensionUIRequestEventDTO,
  RpcForkResultDTO,
  RpcGetResourcesDataDTO,
  RpcGetSessionsDataDTO,
  RpcImageContentDTO,
  RpcModelDTO,
  RpcSessionInfoDTO,
  RpcSessionStateDTO,
  RpcSessionStatsDTO,
  RpcSessionTreeNodeDTO,
  RpcSlashCommandDTO,
  RpcToolCallDTO,
} from "../../../../coding-agent/src/modes/rpc/rpc-desktop-contract.ts";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type QueueMode = "all" | "one-at-a-time";
export type CustomModelApi = "openai-completions" | "anthropic-messages";

// Backend request command types (sent via window.piDesktop.request)

export interface GetStateCommand {
  type: "get_state";
}

export interface GetMessagesCommand {
  type: "get_messages";
}

export interface GetAvailableModelsCommand {
  type: "get_available_models";
}

export interface GetCustomModelsCommand {
  type: "get_custom_models";
}

export interface GetSessionStatsCommand {
  type: "get_session_stats";
}

export interface GetCommandsCommand {
  type: "get_commands";
}

export interface GetResourcesCommand {
  type: "get_resources";
  reload?: boolean;
}

export interface ManagePackageCommand {
  type: "manage_package";
  action: "install" | "remove";
  source: string;
  local?: boolean;
}

export interface GetSessionsCommand {
  type: "get_sessions";
  all?: boolean;
  offset?: number;
  limit?: number;
  query?: string;
}

export interface GetAuthStatusCommand {
  type: "get_auth_status";
  providers?: string[];
}

export interface PromptCommand {
  type: "prompt";
  message: string;
  images?: ImageContent[];
  streamingBehavior?: "followUp" | "steer";
}

export interface AbortCommand {
  type: "abort";
}

export interface NewSessionCommand {
  type: "new_session";
  cwd?: string;
}

export interface SwitchSessionCommand {
  type: "switch_session";
  sessionPath: string;
}

export interface SetModelCommand {
  type: "set_model";
  provider: string;
  modelId: string;
}

export interface CycleModelCommand {
  type: "cycle_model";
}

// Thinking

export interface SetThinkingLevelCommand {
  type: "set_thinking_level";
  level: ThinkingLevel;
}

export interface CycleThinkingLevelCommand {
  type: "cycle_thinking_level";
}

// Queue modes

export interface SetSteeringModeCommand {
  type: "set_steering_mode";
  mode: QueueMode;
}

export interface SetFollowUpModeCommand {
  type: "set_follow_up_mode";
  mode: QueueMode;
}

// Compaction & retry

export interface CompactCommand {
  type: "compact";
  customInstructions?: string;
}

export interface SetAutoCompactionCommand {
  type: "set_auto_compaction";
  enabled: boolean;
}

export interface SetAutoRetryCommand {
  type: "set_auto_retry";
  enabled: boolean;
}

export interface AbortRetryCommand {
  type: "abort_retry";
}

// API key management

export interface SetApiKeyCommand {
  type: "set_api_key";
  provider: string;
  apiKey: string;
}

export interface RemoveApiKeyCommand {
  type: "remove_api_key";
  provider: string;
}

// Model testing

export interface TestModelCommand {
  type: "test_model";
  provider: string;
  modelId: string;
}

export interface TestCustomModelCommand {
  type: "test_custom_model";
  provider: string;
  baseUrl: string;
  api: CustomModelApi;
  apiKey?: string;
  headers?: Record<string, string>;
  modelId: string;
  useStoredAuthProvider?: string;
  preserveHeadersFromProvider?: string;
  proxyUrl?: string;
}

// Custom model CRUD

export interface FetchProviderModelsCommand {
  type: "fetch_provider_models";
  provider: string;
  baseUrl: string;
  api: CustomModelApi;
  apiKey?: string;
  headers?: Record<string, string>;
  useStoredAuthProvider?: string;
  preserveHeadersFromProvider?: string;
  proxyUrl?: string;
}

export interface UpsertCustomModelCommand {
  type: "upsert_custom_model";
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
}

export interface RemoveCustomModelCommand {
  type: "remove_custom_model";
  provider: string;
  modelId: string;
  removeAuthWhenEmpty?: boolean;
}

export interface RemoveCustomProviderCommand {
  type: "remove_custom_provider";
  provider: string;
  removeAuth?: boolean;
}

export interface ReplaceCustomModelsCommand {
  type: "replace_custom_models";
  providers: Record<string, unknown>;
  removeOrphanStoredAuth?: boolean;
}

// Session management

export interface SetSessionNameCommand {
  type: "set_session_name";
  name: string;
}

export interface ExportHtmlCommand {
  type: "export_html";
  outputPath?: string;
}

export interface ForkCommand {
  type: "fork";
  entryId: string;
}

export interface CloneCommand {
  type: "clone";
}

export interface GetForkMessagesCommand {
  type: "get_fork_messages";
}

export interface GetEntriesCommand {
  type: "get_entries";
  since?: string;
}

export interface GetTreeCommand {
  type: "get_tree";
}

export interface GetLastAssistantTextCommand {
  type: "get_last_assistant_text";
}

// Bash

export interface BashCommand {
  type: "bash";
  command: string;
  excludeFromContext?: boolean;
  /** Request id; streamed bash_execution_update events carry the same id. */
  id?: string;
}

export interface AbortBashCommand {
  type: "abort_bash";
  executionId?: string;
}

// Steering / follow-up

export interface SteerCommand {
  type: "steer";
  message: string;
  images?: ImageContent[];
}

export interface FollowUpCommand {
  type: "follow_up";
  message: string;
  images?: ImageContent[];
}

// Extension flags (e.g. permission mode)

export interface SetExtensionFlagCommand {
  type: "set_extension_flag";
  name: string;
  value: boolean | string;
}

// Project trust

export interface SetProjectTrustCommand {
  type: "set_project_trust";
  trusted: boolean;
}

export interface GetProjectTrustEntriesCommand {
  type: "get_project_trust_entries";
}

export interface SetProjectTrustEntryCommand {
  type: "set_project_trust_entry";
  path: string;
  decision: boolean | null;
}

export interface ProjectTrustEntry {
  path: string;
  decision: boolean;
}

export interface ProjectTrustEntries {
  entries: ProjectTrustEntry[];
  currentPath: string;
  currentEntryPath: string | null;
  currentTrusted: boolean;
}

export interface ProjectTrustEntryUpdate {
  entries: ProjectTrustEntry[];
  currentEntryPath: string | null;
  trusted: boolean;
  reloaded: boolean;
}

export type BackendCommand =
  | GetStateCommand
  | GetMessagesCommand
  | GetAvailableModelsCommand
  | GetCustomModelsCommand
  | GetSessionStatsCommand
  | GetCommandsCommand
  | GetResourcesCommand
  | ManagePackageCommand
  | GetSessionsCommand
  | GetAuthStatusCommand
  | PromptCommand
  | AbortCommand
  | NewSessionCommand
  | SwitchSessionCommand
  | SetModelCommand
  | CycleModelCommand
  | SetThinkingLevelCommand
  | CycleThinkingLevelCommand
  | SetSteeringModeCommand
  | SetFollowUpModeCommand
  | CompactCommand
  | SetAutoCompactionCommand
  | SetAutoRetryCommand
  | AbortRetryCommand
  | SetApiKeyCommand
  | RemoveApiKeyCommand
  | TestModelCommand
  | TestCustomModelCommand
  | FetchProviderModelsCommand
  | UpsertCustomModelCommand
  | RemoveCustomModelCommand
  | RemoveCustomProviderCommand
  | ReplaceCustomModelsCommand
  | SetSessionNameCommand
  | ExportHtmlCommand
  | ForkCommand
  | CloneCommand
  | GetForkMessagesCommand
  | GetEntriesCommand
  | GetTreeCommand
  | GetLastAssistantTextCommand
  | BashCommand
  | AbortBashCommand
  | SteerCommand
  | FollowUpCommand
  | SetExtensionFlagCommand
  | SetProjectTrustCommand
  | GetProjectTrustEntriesCommand
  | SetProjectTrustEntryCommand;

// Fire-and-forget commands (sent via window.piDesktop.send)

export interface ExtensionUIResponseCommand {
  type: "extension_ui_response";
  id: string;
  [key: string]: unknown;
}

export type BackendSendCommand = ExtensionUIResponseCommand;

// Backend event types (received via onEvent).
//
// The wire union is defined by the backend as RpcBackendEventDTO. The renderer
// only needs to discriminate on `type`, so BackendEvent is that union directly.

export type BackendEvent = RpcBackendEventDTO;

export type ExtensionUIRequestEvent = RpcExtensionUIRequestEventDTO;
export type ExtensionUIRequestClosedEvent = RpcExtensionUIRequestClosedEventDTO;

// Domain models. These are re-exported straight from the backend wire contract
// so field names match exactly what crosses stdio (e.g. Model.id, not modelId;
// Message.content is a content-block array, not a string).

export type Message = RpcAgentMessageDTO;
export type ImageContent = RpcImageContentDTO;
export type ToolCall = RpcToolCallDTO;
export type AssistantContentBlock = RpcAssistantContentBlockDTO;
export type Model = RpcModelDTO;
export type AuthStatus = RpcAuthStatusDTO;
export type SessionInfo = RpcSessionInfoDTO;
export type SessionListPage = RpcGetSessionsDataDTO;
export type ForkResult = RpcForkResultDTO;
export type SessionState = RpcSessionStateDTO;
export type SessionStats = RpcSessionStatsDTO;
export type SlashCommand = RpcSlashCommandDTO;
export type ResourcesData = RpcGetResourcesDataDTO;
export type CustomModelsConfig = RpcCustomModelsConfigDTO;

export interface ForkMessage {
  entryId: string;
  text: string;
}

export type SessionTreeNode = RpcSessionTreeNodeDTO;

export interface SessionTreeData {
  tree: SessionTreeNode[];
  leafId: string | null;
}

// Backend status (from getBackendStatus / onStatus)

export interface BackendStatus {
  ready: boolean;
  starting: boolean;
  restarting: boolean;
  retryInMs: number;
  restartAttempts: number;
  backendPath: string;
  cwd: string;
  error?: string;
}

export interface LogEntry {
  level: string;
  message: string;
}

export interface WorkspaceGitStatus {
  cwd: string;
  kind: "repository" | "not-repository" | "unavailable";
  branch: string | null;
  detached: boolean;
  dirty: boolean;
  // Optional so the renderer tolerates an older backend during a version skew;
  // the current backend always sends them. summarizeGitSync defaults them.
  upstream?: string | null;
  ahead?: number;
  behind?: number;
}

export type WorkspaceFilePreviewKind = "text" | "html" | "image" | "pdf" | "spreadsheet" | "unsupported" | "too-large";

export interface WorkspaceSpreadsheetSheet {
  name: string;
  rows: string[][];
}

export interface WorkspaceFilePreview {
  path: string;
  size: number;
  modifiedAt: number;
  mimeType: string;
  kind: WorkspaceFilePreviewKind;
  content?: string;
  dataBase64?: string;
  sheets?: WorkspaceSpreadsheetSheet[];
  truncated?: boolean;
}

export interface GitChangeFile {
  status: string;
  path: string;
}

export interface GitChanges {
  files: GitChangeFile[];
  truncated: boolean;
}

export type GitDiffSectionName = "staged" | "unstaged";
export type GitHunkAction = "stage" | "unstage" | "discard";

export interface GitDiffSection {
  patch: string;
  hash: string;
  canDiscard: boolean;
}

export interface GitFileDiff {
  staged: GitDiffSection;
  unstaged: GitDiffSection;
}

export interface GitHunkResult {
  applied: boolean;
  section: GitDiffSectionName;
  action: GitHunkAction;
}

export interface GitBranch {
  name: string;
  current: boolean;
}

export interface GitBranches {
  branches: GitBranch[];
  current: string | null;
}

export interface GitPushResult {
  pushed: boolean;
  branch: string;
  setUpstream: boolean;
  summary: string;
}

export interface GitSwitchResult {
  switched: boolean;
  branch: string;
  created: boolean;
}

export interface GitPrRemote {
  host: string;
  owner: string;
  repo: string;
}

export type GitPrFeedbackKind = "comment" | "review" | "inline";

export interface GitPrFeedback {
  kind: GitPrFeedbackKind;
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url: string;
  state?: string;
  path?: string;
  line?: number;
  side?: string;
  threadId?: string;
  resolved?: boolean;
  outdated?: boolean;
  canReply?: boolean;
  canResolve?: boolean;
  canUnresolve?: boolean;
}

export interface GitPrReview {
  number: number;
  title: string;
  url: string;
  state: string;
  reviewDecision?: string;
  feedback: GitPrFeedback[];
  partial: boolean;
}

export type GitPrReviewAction =
  | { type: "comment"; body: string }
  | { type: "reply"; threadId: string; body: string }
  | { type: "resolve"; threadId: string; resolved: boolean };

export interface GitPrContext {
  branch: string | null;
  detached: boolean;
  baseBranch: string | null;
  remote: GitPrRemote | null;
  isGitHub: boolean;
  compareUrl: string | null;
  lastCommitSubject: string;
  hasUpstream: boolean;
  ghAvailable: boolean;
}

export interface GitPrResult {
  created: boolean;
  method: "gh" | "compare";
  url: string;
}

export type MirrorManager = "npm" | "pip" | "cargo";

export interface MirrorStatus {
  manager: MirrorManager;
  /** Preset id, or "custom" when the configured URL matches no preset. */
  current: string;
  currentUrl: string;
  configExists: boolean;
}

export interface MirrorPreset {
  id: string;
  nameEn: string;
  nameZh: string;
  url: string;
}

export interface MirrorStatusResult {
  sources: MirrorStatus[];
  /** Sent by the main process so the renderer never keeps its own mirror list. */
  presets: Record<MirrorManager, MirrorPreset[]>;
}

export interface MirrorApplyResult {
  ok: boolean;
  manager: string;
  sourceId: string;
  url: string;
  path: string;
}
