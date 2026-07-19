/**
 * Desktop RPC wire contract.
 *
 * Self-contained, flat plain-JSON descriptions of exactly what crosses the
 * stdio JSON-RPC boundary to the Pi Studio renderer (i.e. the shapes the
 * renderer actually receives after `JSON.stringify`). This file intentionally
 * imports zero workspace generics so the renderer's standalone `tsc --noEmit`
 * (moduleResolution: bundler, no workspace type graph) can resolve it via a
 * type-only relative import.
 *
 * `rpc-mode.ts` annotates its serialized outputs with `satisfies` against these
 * types, so backend output that drifts from this contract is a compile error.
 * Fields that are class instances in memory but serialize to primitives (e.g.
 * `Date` -> ISO string in `RpcSessionInfoDTO`) describe the post-serialization
 * wire value and are therefore not `satisfies`-checked at the source object.
 */

export type RpcThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type RpcQueueMode = "all" | "one-at-a-time";
export type RpcCustomModelApi = "openai-completions" | "anthropic-messages";
export type RpcConnectionErrorCategory =
	| "auth"
	| "endpoint"
	| "model"
	| "rate_limit"
	| "timeout"
	| "protocol"
	| "unknown";

// ============================================================================
// Model
// ============================================================================

export interface RpcModelCostDTO {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/** Flat projection of pi-ai `Model<Api>` as sent to the renderer. */
export interface RpcModelDTO {
	id: string;
	name: string;
	api: string;
	provider: string;
	baseUrl: string;
	reasoning: boolean;
	thinkingLevelMap?: Record<string, string | null>;
	input: ("text" | "image")[];
	cost: RpcModelCostDTO;
	contextWindow: number;
	maxTokens: number;
	headers?: Record<string, string>;
}

// ============================================================================
// Messages (pi-agent-core AgentMessage projected onto the wire)
// ============================================================================

export interface RpcTextContentDTO {
	type: "text";
	text: string;
	textSignature?: string;
}

export interface RpcThinkingContentDTO {
	type: "thinking";
	thinking: string;
	thinkingSignature?: string;
	redacted?: boolean;
}

export interface RpcImageContentDTO {
	type: "image";
	data: string;
	mimeType: string;
}

export interface RpcToolCallDTO {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	thoughtSignature?: string;
}

export type RpcUserContentBlockDTO = RpcTextContentDTO | RpcImageContentDTO;
export type RpcAssistantContentBlockDTO = RpcTextContentDTO | RpcThinkingContentDTO | RpcToolCallDTO;
export type RpcToolResultContentBlockDTO = RpcTextContentDTO | RpcImageContentDTO;

export interface RpcUsageDTO {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cacheWrite1h?: number;
	reasoning?: number;
	totalTokens: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

export type RpcStopReasonDTO = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface RpcUserMessageDTO {
	role: "user";
	content: string | RpcUserContentBlockDTO[];
	timestamp: number;
}

export interface RpcAssistantMessageDTO {
	role: "assistant";
	content: RpcAssistantContentBlockDTO[];
	api: string;
	provider: string;
	model: string;
	responseModel?: string;
	responseId?: string;
	usage: RpcUsageDTO;
	stopReason: RpcStopReasonDTO;
	errorMessage?: string;
	timestamp: number;
}

export interface RpcToolResultMessageDTO {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: RpcToolResultContentBlockDTO[];
	isError: boolean;
	timestamp: number;
	/**
	 * Structured tool details for desktop UI (e.g. edit/write `{ patch, diff }`).
	 * Opaque on the wire; clients extract known fields when present.
	 */
	details?: unknown;
}

export interface RpcBashExecutionMessageDTO {
	role: "bashExecution";
	command: string;
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
	fullOutputPath?: string;
	timestamp: number;
	excludeFromContext?: boolean;
}

export interface RpcCustomMessageDTO {
	role: "custom";
	customType: string;
	content: string | RpcUserContentBlockDTO[];
	display: boolean;
	timestamp: number;
}

export interface RpcBranchSummaryMessageDTO {
	role: "branchSummary";
	summary: string;
	fromId: string;
	timestamp: number;
}

export interface RpcCompactionSummaryMessageDTO {
	role: "compactionSummary";
	summary: string;
	tokensBefore: number;
	timestamp: number;
}

export type RpcAgentMessageDTO =
	| RpcUserMessageDTO
	| RpcAssistantMessageDTO
	| RpcToolResultMessageDTO
	| RpcBashExecutionMessageDTO
	| RpcCustomMessageDTO
	| RpcBranchSummaryMessageDTO
	| RpcCompactionSummaryMessageDTO;

// ============================================================================
// State, stats, sessions, auth, commands, custom models
// ============================================================================

export interface RpcSessionStateDTO {
	model?: RpcModelDTO;
	thinkingLevel: RpcThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: RpcQueueMode;
	followUpMode: RpcQueueMode;
	cwd: string;
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	autoCompactionEnabled: boolean;
	autoRetryEnabled: boolean;
	isRetrying: boolean;
	retryAttempt: number;
	messageCount: number;
	pendingMessageCount: number;
}

export interface RpcContextUsageDTO {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

export interface RpcSessionStatsDTO {
	sessionFile: string | undefined;
	sessionId: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	cost: number;
	contextUsage?: RpcContextUsageDTO;
}

export interface RpcAuthStatusDTO {
	configured: boolean;
	source?: "stored" | "runtime" | "environment" | "fallback" | "models_json_key" | "models_json_command";
	label?: string;
}

/**
 * `SessionInfo` on the wire. `created`/`modified` are `Date` instances in the
 * backend and serialize to ISO date strings, so they are typed as `string`
 * here and this shape is not `satisfies`-checked against the source object.
 */
export interface RpcSessionInfoDTO {
	path: string;
	id: string;
	cwd: string;
	name?: string;
	parentSessionPath?: string;
	created: string;
	modified: string;
	messageCount: number;
	firstMessage: string;
	allMessagesText: string;
}

export interface RpcSessionTreeEntryDTO {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
	summary?: string;
}

export interface RpcSessionTreeNodeDTO {
	entry: RpcSessionTreeEntryDTO;
	children: RpcSessionTreeNodeDTO[];
	label?: string;
	labelTimestamp?: string;
}

export interface RpcSourceInfoDTO {
	path: string;
	source: string;
	scope: "user" | "project" | "temporary";
	origin: "package" | "top-level";
	baseDir?: string;
}

export interface RpcSlashCommandDTO {
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill";
	sourceInfo: RpcSourceInfoDTO;
}

export type RpcResourceKindDTO = "extension" | "skill" | "prompt";

export interface RpcResourceItemDTO {
	name: string;
	description?: string;
	path: string;
	sourceInfo: RpcSourceInfoDTO;
}

export interface RpcResourceDiagnosticDTO {
	resource: RpcResourceKindDTO;
	type: "warning" | "error" | "collision";
	message: string;
	path?: string;
}

export interface RpcExtensionFlagDTO {
	name: string;
	type: "boolean" | "string";
	description?: string;
	default?: boolean | string;
	extensionPath: string;
}

export interface RpcCustomModelConfigModelDTO {
	id: string;
	name?: string;
	api?: string;
	reasoning?: boolean;
	input?: ("text" | "image")[];
	contextWindow?: number;
	maxTokens?: number;
	cost?: RpcModelCostDTO;
}

export interface RpcCustomModelProviderDTO {
	baseUrl?: string;
	headers?: Record<string, string>;
	api?: string;
	authKind?: "api_key" | "none";
	hasStoredAuth?: boolean;
	proxyUrl?: string;
	models?: RpcCustomModelConfigModelDTO[];
}

export interface RpcCustomModelsConfigDTO {
	path: string;
	providers: Record<string, RpcCustomModelProviderDTO>;
}

export interface RpcTestModelResultDTO {
	ok: boolean;
	latencyMs: number;
	category?: RpcConnectionErrorCategory;
	message?: string;
}

// ============================================================================
// Response payloads (the `data` field of `RpcResponse` per command)
// ============================================================================

export interface RpcGetStateDataDTO {
	// `get_state` returns the session state object directly.
	// (Alias kept for symmetry with other command payloads.)
	model?: RpcModelDTO;
	thinkingLevel: RpcThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: RpcQueueMode;
	followUpMode: RpcQueueMode;
	cwd: string;
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	autoCompactionEnabled: boolean;
	autoRetryEnabled: boolean;
	isRetrying: boolean;
	retryAttempt: number;
	messageCount: number;
	pendingMessageCount: number;
}

export interface RpcGetAvailableModelsDataDTO {
	models: RpcModelDTO[];
}

export interface RpcGetMessagesDataDTO {
	messages: RpcAgentMessageDTO[];
}

export interface RpcGetAuthStatusDataDTO {
	providers: Record<string, RpcAuthStatusDTO>;
}

export interface RpcGetCustomModelsDataDTO {
	path: string;
	providers: Record<string, RpcCustomModelProviderDTO>;
}

export interface RpcFetchProviderModelsDataDTO {
	models: Array<{ id: string; name?: string }>;
}

export interface RpcGetSessionsDataDTO {
	sessions: RpcSessionInfoDTO[];
	total: number;
	hasMore: boolean;
	nextOffset: number | null;
}

export interface RpcSessionChangeResultDTO {
	cancelled: boolean;
	cwd: string;
}

export type RpcForkResultDTO = { cancelled: true; text?: never } | { cancelled: false; text: string };

export interface RpcGetCommandsDataDTO {
	commands: RpcSlashCommandDTO[];
}

export interface RpcGetResourcesDataDTO {
	extensions: RpcResourceItemDTO[];
	skills: RpcResourceItemDTO[];
	prompts: RpcResourceItemDTO[];
	diagnostics: RpcResourceDiagnosticDTO[];
	extensionFlags: RpcExtensionFlagDTO[];
}

// ============================================================================
// Backend events (emitted from session.subscribe, forwarded verbatim)
// ============================================================================

export interface RpcMessageEventDTO {
	type: "message_start" | "message_update" | "message_end";
	message: RpcAgentMessageDTO;
}

export interface RpcAgentStartEventDTO {
	type: "agent_start";
}

export interface RpcAgentEndEventDTO {
	type: "agent_end";
	messages: RpcAgentMessageDTO[];
	willRetry: boolean;
}

export interface RpcToolExecutionStartEventDTO {
	type: "tool_execution_start";
	toolCallId: string;
	toolName: string;
	args: unknown;
}

export interface RpcToolExecutionEndEventDTO {
	type: "tool_execution_end";
	toolCallId: string;
	toolName: string;
	result: unknown;
	isError: boolean;
}

export interface RpcQueueUpdateEventDTO {
	type: "queue_update";
	steering: readonly string[];
	followUp: readonly string[];
}

export interface RpcCompactionStartEventDTO {
	type: "compaction_start";
	reason: "manual" | "threshold" | "overflow";
}

export interface RpcCompactionEndEventDTO {
	type: "compaction_end";
	reason: "manual" | "threshold" | "overflow";
	aborted: boolean;
	willRetry: boolean;
	errorMessage?: string;
}

export interface RpcAutoRetryStartEventDTO {
	type: "auto_retry_start";
	attempt: number;
	maxAttempts: number;
	delayMs: number;
	errorMessage: string;
}

export interface RpcAutoRetryEndEventDTO {
	type: "auto_retry_end";
	success: boolean;
	attempt: number;
	finalError?: string;
}

export interface RpcExtensionUIRequestEventDTO {
	type: "extension_ui_request";
	id: string;
	method: string;
	[key: string]: unknown;
}

export interface RpcExtensionUIRequestClosedEventDTO {
	type: "extension_ui_request_closed";
	id: string;
	reason: "aborted" | "timeout";
}

/** Emitted when an extension command replaces the active session. */
export interface RpcSessionChangedEventDTO {
	type: "session_changed";
	cwd: string;
	sessionId: string;
	sessionFile?: string;
	reason: "extension_command";
}

export type RpcBackendEventDTO =
	| RpcMessageEventDTO
	| RpcAgentStartEventDTO
	| RpcAgentEndEventDTO
	| RpcToolExecutionStartEventDTO
	| RpcToolExecutionEndEventDTO
	| RpcQueueUpdateEventDTO
	| RpcCompactionStartEventDTO
	| RpcCompactionEndEventDTO
	| RpcAutoRetryStartEventDTO
	| RpcAutoRetryEndEventDTO
	| RpcExtensionUIRequestEventDTO
	| RpcExtensionUIRequestClosedEventDTO
	| RpcSessionChangedEventDTO;
