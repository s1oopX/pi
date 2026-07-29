/**
 * RPC protocol types for headless operation.
 *
 * Commands are sent as JSON lines on stdin.
 * Responses and events are emitted as JSON lines on stdout.
 */

import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type { SessionStats } from "../../core/agent-session.ts";
import type { BashResult } from "../../core/bash-executor.ts";
import type { CompactionResult } from "../../core/compaction/index.ts";
import type { AuthStatus } from "../../core/provider-composer.ts";
import type { SessionEntry, SessionInfo } from "../../core/session-manager.ts";
import type { SourceInfo } from "../../core/source-info.ts";
import type {
	RpcForkResultDTO,
	RpcMemorySettingsDataDTO,
	RpcResetMemoriesDataDTO,
	RpcSessionChangeResultDTO,
	RpcSessionTreeNodeDTO,
} from "./rpc-desktop-contract.ts";

export interface RpcGetSessionsOptions {
	all?: boolean;
	cwd?: string;
	offset?: number;
	limit?: number;
	query?: string;
}

export interface RpcGetResourcesOptions {
	reload?: boolean;
}

export interface RpcGetSessionsData {
	sessions: SessionInfo[];
	total: number;
	hasMore: boolean;
	nextOffset: number | null;
}

// ============================================================================
// RPC Commands (stdin)
// ============================================================================

export type RpcCommand =
	// Prompting
	| { id?: string; type: "prompt"; message: string; images?: ImageContent[]; streamingBehavior?: "steer" | "followUp" }
	| { id?: string; type: "steer"; message: string; images?: ImageContent[] }
	| { id?: string; type: "follow_up"; message: string; images?: ImageContent[] }
	| { id?: string; type: "abort" }
	| { id?: string; type: "new_session"; cwd?: string; parentSession?: string }

	// State
	| { id?: string; type: "get_state" }
	| { id?: string; type: "get_memory_settings" }
	| {
			id?: string;
			type: "set_memory_settings";
			enabled?: boolean;
			allowToolChats?: boolean;
			useMemories?: boolean;
			generateMemories?: boolean;
	  }
	| { id?: string; type: "reset_memories" }

	// Model
	| { id?: string; type: "set_model"; provider: string; modelId: string }
	| { id?: string; type: "cycle_model" }
	| { id?: string; type: "get_available_models" }
	| { id?: string; type: "get_auth_status"; providers?: string[] }
	| { id?: string; type: "set_api_key"; provider: string; apiKey: string }
	| { id?: string; type: "remove_api_key"; provider: string }
	| { id?: string; type: "get_custom_models" }
	| {
			id?: string;
			type: "replace_custom_models";
			providers: Record<string, unknown>;
			removeOrphanStoredAuth?: boolean;
	  }
	| {
			id?: string;
			type: "fetch_provider_models";
			provider: string;
			baseUrl: string;
			api: "openai-completions" | "anthropic-messages";
			apiKey?: string;
			headers?: Record<string, string>;
			useStoredAuthProvider?: string;
			preserveHeadersFromProvider?: string;
			proxyUrl?: string;
	  }
	| { id?: string; type: "test_model"; provider: string; modelId: string }
	| {
			id?: string;
			type: "test_custom_model";
			provider: string;
			baseUrl: string;
			api: "openai-completions" | "anthropic-messages";
			apiKey?: string;
			headers?: Record<string, string>;
			modelId: string;
			useStoredAuthProvider?: string;
			preserveHeadersFromProvider?: string;
			proxyUrl?: string;
	  }
	| {
			id?: string;
			type: "upsert_custom_model";
			provider: string;
			baseUrl: string;
			api: "openai-completions" | "anthropic-messages";
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
	| { id?: string; type: "remove_custom_model"; provider: string; modelId: string; removeAuthWhenEmpty?: boolean }
	| { id?: string; type: "remove_custom_provider"; provider: string; removeAuth?: boolean }

	// Thinking
	| { id?: string; type: "set_thinking_level"; level: ThinkingLevel }
	| { id?: string; type: "cycle_thinking_level" }
	| { id?: string; type: "get_available_thinking_levels" }

	// Queue modes
	| { id?: string; type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
	| { id?: string; type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }

	// Compaction
	| { id?: string; type: "compact"; customInstructions?: string }
	| { id?: string; type: "set_auto_compaction"; enabled: boolean }

	// Retry
	| { id?: string; type: "set_auto_retry"; enabled: boolean }
	| { id?: string; type: "abort_retry" }

	// Bash
	| { id?: string; type: "bash"; command: string; excludeFromContext?: boolean }
	| { id?: string; type: "abort_bash"; executionId?: string }

	// Session
	| { id?: string; type: "get_session_stats" }
	| { id?: string; type: "export_html"; outputPath?: string }
	| ({ id?: string; type: "get_sessions" } & RpcGetSessionsOptions)
	| { id?: string; type: "switch_session"; sessionPath: string }
	| { id?: string; type: "fork"; entryId: string }
	| { id?: string; type: "clone" }
	| { id?: string; type: "get_fork_messages" }
	| { id?: string; type: "get_entries"; since?: string }
	| { id?: string; type: "get_tree" }
	| { id?: string; type: "get_last_assistant_text" }
	| { id?: string; type: "set_session_name"; name: string }

	// Messages
	| { id?: string; type: "get_messages" }

	// Commands (available for invocation via prompt)
	| { id?: string; type: "get_commands" }
	| ({ id?: string; type: "get_resources" } & RpcGetResourcesOptions)
	| {
			id?: string;
			type: "manage_package";
			action: "install" | "remove";
			source: string;
			local?: boolean;
	  }

	// Extension flags (runtime-settable, e.g. permission mode)
	| { id?: string; type: "set_extension_flag"; name: string; value: boolean | string }

	// Project trust (load project-local extensions/settings for this cwd)
	| { id?: string; type: "set_project_trust"; trusted: boolean }
	| { id?: string; type: "get_project_trust_entries" }
	| { id?: string; type: "set_project_trust_entry"; path: string; decision: boolean | null };

// ============================================================================
// RPC Slash Command (for get_commands response)
// ============================================================================

/** A command available for invocation via prompt */
export interface RpcSlashCommand {
	/** Command name (without leading slash) */
	name: string;
	/** Human-readable description */
	description?: string;
	/** What kind of command this is */
	source: "extension" | "prompt" | "skill";
	/** Source metadata for the owning resource */
	sourceInfo: SourceInfo;
}

// ============================================================================
// RPC State
// ============================================================================

export interface RpcSessionState {
	model?: Model<any>;
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
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
	/** Whether project-local extensions/settings for this cwd are trusted to load. */
	projectTrusted: boolean;
	/** Whether this cwd has project-local resources that require a trust decision. */
	projectTrustRequired: boolean;
}

// ============================================================================
// RPC Responses (stdout)
// ============================================================================

// Success responses with data
export type RpcResponse =
	// Prompting (async - events follow)
	| { id?: string; type: "response"; command: "prompt"; success: true }
	| { id?: string; type: "response"; command: "steer"; success: true }
	| { id?: string; type: "response"; command: "follow_up"; success: true }
	| { id?: string; type: "response"; command: "abort"; success: true }
	| { id?: string; type: "response"; command: "new_session"; success: true; data: RpcSessionChangeResultDTO }

	// State
	| { id?: string; type: "response"; command: "get_state"; success: true; data: RpcSessionState }
	| {
			id?: string;
			type: "response";
			command: "get_memory_settings";
			success: true;
			data: RpcMemorySettingsDataDTO;
	  }
	| {
			id?: string;
			type: "response";
			command: "set_memory_settings";
			success: true;
			data: RpcMemorySettingsDataDTO;
	  }
	| {
			id?: string;
			type: "response";
			command: "reset_memories";
			success: true;
			data: RpcResetMemoriesDataDTO;
	  }

	// Model
	| {
			id?: string;
			type: "response";
			command: "set_model";
			success: true;
			data: Model<any>;
	  }
	| {
			id?: string;
			type: "response";
			command: "cycle_model";
			success: true;
			data: { model: Model<any>; thinkingLevel: ThinkingLevel; isScoped: boolean } | null;
	  }
	| {
			id?: string;
			type: "response";
			command: "get_available_models";
			success: true;
			data: { models: Model<any>[] };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_auth_status";
			success: true;
			data: { providers: Record<string, AuthStatus> };
	  }
	| {
			id?: string;
			type: "response";
			command: "set_api_key";
			success: true;
			data: { provider: string; status: AuthStatus };
	  }
	| {
			id?: string;
			type: "response";
			command: "remove_api_key";
			success: true;
			data: { provider: string; status: AuthStatus };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_custom_models";
			success: true;
			data: { path: string; providers: Record<string, unknown> };
	  }
	| {
			id?: string;
			type: "response";
			command: "replace_custom_models";
			success: true;
			data: { path: string; providers: number; models: number; removedStoredAuthProviders: string[] };
	  }
	| {
			id?: string;
			type: "response";
			command: "fetch_provider_models";
			success: true;
			data: { models: Array<{ id: string; name?: string }> };
	  }
	| {
			id?: string;
			type: "response";
			command: "test_model";
			success: true;
			data: {
				ok: boolean;
				latencyMs: number;
				category?: "auth" | "endpoint" | "model" | "rate_limit" | "timeout" | "protocol" | "unknown";
				message?: string;
			};
	  }
	| {
			id?: string;
			type: "response";
			command: "test_custom_model";
			success: true;
			data: {
				ok: boolean;
				latencyMs: number;
				category?: "auth" | "endpoint" | "model" | "rate_limit" | "timeout" | "protocol" | "unknown";
				message?: string;
			};
	  }
	| {
			id?: string;
			type: "response";
			command: "upsert_custom_model";
			success: true;
			data: { path: string; provider: string; modelId: string };
	  }
	| {
			id?: string;
			type: "response";
			command: "remove_custom_model";
			success: true;
			data: { path: string; provider: string; modelId: string };
	  }
	| {
			id?: string;
			type: "response";
			command: "remove_custom_provider";
			success: true;
			data: { path: string; provider: string };
	  }

	// Thinking
	| { id?: string; type: "response"; command: "set_thinking_level"; success: true }
	| {
			id?: string;
			type: "response";
			command: "cycle_thinking_level";
			success: true;
			data: { level: ThinkingLevel } | null;
	  }
	| {
			id?: string;
			type: "response";
			command: "get_available_thinking_levels";
			success: true;
			data: { levels: ThinkingLevel[] };
	  }

	// Queue modes
	| { id?: string; type: "response"; command: "set_steering_mode"; success: true }
	| { id?: string; type: "response"; command: "set_follow_up_mode"; success: true }

	// Compaction
	| { id?: string; type: "response"; command: "compact"; success: true; data: CompactionResult }
	| { id?: string; type: "response"; command: "set_auto_compaction"; success: true }

	// Retry
	| { id?: string; type: "response"; command: "set_auto_retry"; success: true }
	| { id?: string; type: "response"; command: "abort_retry"; success: true }

	// Bash
	| { id?: string; type: "response"; command: "bash"; success: true; data: BashResult }
	| { id?: string; type: "response"; command: "abort_bash"; success: true }

	// Session
	| { id?: string; type: "response"; command: "get_session_stats"; success: true; data: SessionStats }
	| { id?: string; type: "response"; command: "export_html"; success: true; data: { path: string } }
	| { id?: string; type: "response"; command: "get_sessions"; success: true; data: RpcGetSessionsData }
	| { id?: string; type: "response"; command: "switch_session"; success: true; data: RpcSessionChangeResultDTO }
	| { id?: string; type: "response"; command: "fork"; success: true; data: RpcForkResultDTO }
	| { id?: string; type: "response"; command: "clone"; success: true; data: { cancelled: boolean } }
	| {
			id?: string;
			type: "response";
			command: "get_fork_messages";
			success: true;
			data: { messages: Array<{ entryId: string; text: string }> };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_entries";
			success: true;
			data: { entries: SessionEntry[]; leafId: string | null };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_tree";
			success: true;
			data: { tree: RpcSessionTreeNodeDTO[]; leafId: string | null };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_last_assistant_text";
			success: true;
			data: { text: string | null };
	  }
	| { id?: string; type: "response"; command: "set_session_name"; success: true }

	// Messages
	| { id?: string; type: "response"; command: "get_messages"; success: true; data: { messages: AgentMessage[] } }

	// Commands
	| {
			id?: string;
			type: "response";
			command: "get_commands";
			success: true;
			data: { commands: RpcSlashCommand[] };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_resources";
			success: true;
			data: {
				packages: Array<{
					source: string;
					scope: "user" | "project";
					filtered: boolean;
					installedPath?: string;
				}>;
				extensions: Array<{ name: string; path: string; sourceInfo: SourceInfo }>;
				skills: Array<{ name: string; description?: string; path: string; sourceInfo: SourceInfo }>;
				prompts: Array<{ name: string; description?: string; path: string; sourceInfo: SourceInfo }>;
				diagnostics: Array<{
					resource: "extension" | "skill" | "prompt";
					type: "warning" | "error" | "collision";
					message: string;
					path?: string;
				}>;
				extensionFlags: Array<{
					name: string;
					type: "boolean" | "string";
					description?: string;
					default?: boolean | string;
					extensionPath: string;
				}>;
			};
	  }
	| {
			id?: string;
			type: "response";
			command: "manage_package";
			success: true;
			data: { removed?: boolean };
	  }
	| {
			id?: string;
			type: "response";
			command: "set_project_trust";
			success: true;
			data: { trusted: boolean; projectTrustRequired: boolean };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_project_trust_entries";
			success: true;
			data: {
				entries: Array<{ path: string; decision: boolean }>;
				currentPath: string;
				/** Store entry that covers the current workspace, if any. */
				currentEntryPath: string | null;
				currentTrusted: boolean;
			};
	  }
	| {
			id?: string;
			type: "response";
			command: "set_project_trust_entry";
			success: true;
			data: {
				entries: Array<{ path: string; decision: boolean }>;
				currentEntryPath: string | null;
				trusted: boolean;
				/** True when the change affected the current workspace and the session reloaded. */
				reloaded: boolean;
			};
	  }

	// Error response (any command can fail)
	| { id?: string; type: "response"; command: string; success: false; error: string };

// ============================================================================
// Extension UI Events (stdout)
// ============================================================================

/** Emitted when an extension needs user input */
export type RpcExtensionUIRequest =
	| { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string; timeout?: number }
	| {
			type: "extension_ui_request";
			id: string;
			method: "input";
			title: string;
			placeholder?: string;
			timeout?: number;
	  }
	| { type: "extension_ui_request"; id: string; method: "editor"; title: string; prefill?: string }
	| {
			type: "extension_ui_request";
			id: string;
			method: "notify";
			message: string;
			notifyType?: "info" | "warning" | "error";
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setStatus";
			statusKey: string;
			statusText: string | undefined;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setWidget";
			widgetKey: string;
			widgetLines: string[] | undefined;
			widgetPlacement?: "aboveEditor" | "belowEditor";
	  }
	| { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
	| { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string };

/** Emitted when the backend settles an interactive request without a client response. */
export interface RpcExtensionUIRequestClosed {
	type: "extension_ui_request_closed";
	id: string;
	reason: "aborted" | "timeout";
}

// ============================================================================
// Extension UI Commands (stdin)
// ============================================================================

/** Response to an extension UI request */
export type RpcExtensionUIResponse =
	| { type: "extension_ui_response"; id: string; value: string }
	| { type: "extension_ui_response"; id: string; confirmed: boolean }
	| { type: "extension_ui_response"; id: string; cancelled: true };

// ============================================================================
// Helper type for extracting command types
// ============================================================================

export type RpcCommandType = RpcCommand["type"];
