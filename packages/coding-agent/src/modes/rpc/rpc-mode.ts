/**
 * RPC mode: Headless operation with JSON stdin/stdout protocol.
 *
 * Used for embedding the agent in other applications.
 * Receives commands as JSON on stdin, outputs events and responses as JSON on stdout.
 *
 * Protocol:
 * - Commands: JSON objects with `type` field, optional `id` for correlation
 * - Responses: JSON objects with `type: "response"`, `command`, `success`, and optional `data`/`error`
 * - Events: AgentSessionEvent objects streamed as they occur
 * - Extension UI: Extension UI requests are emitted, client responds with extension_ui_response
 */

import * as crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Api, completeSimple, type Model } from "@earendil-works/pi-ai/compat";
import { getModelsPath } from "../../config.ts";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	WorkingIndicatorOptions,
} from "../../core/extensions/index.ts";
import {
	flushRawStdout,
	takeOverStdout,
	waitForRawStdoutBackpressure,
	writeRawStdout,
} from "../../core/output-guard.ts";
import { SessionManager } from "../../core/session-manager.ts";
import { killTrackedDetachedChildren } from "../../utils/shell.ts";
import { type Theme, theme } from "../interactive/theme/theme.ts";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.ts";
import type {
	RpcGetAuthStatusDataDTO,
	RpcGetAvailableModelsDataDTO,
	RpcGetCommandsDataDTO,
	RpcGetCustomModelsDataDTO,
	RpcGetMessagesDataDTO,
	RpcSessionStateDTO,
	RpcSessionStatsDTO,
} from "./rpc-desktop-contract.ts";
import type {
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
	RpcSessionState,
	RpcSlashCommand,
} from "./rpc-types.ts";

// Re-export types for consumers
export type {
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
	RpcSessionState,
} from "./rpc-types.ts";

type CustomModelsConfig = {
	providers: Record<
		string,
		{
			baseUrl?: string;
			headers?: Record<string, string>;
			api?: string;
			apiKey?: string;
			models?: Array<{
				id: string;
				name?: string;
				api?: string;
				reasoning?: boolean;
				input?: ("text" | "image")[];
				contextWindow?: number;
				maxTokens?: number;
				cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
			}>;
		}
	>;
};

const REDACTED_CONFIG_VALUE = "<redacted>";

function isSensitiveHeader(name: string): boolean {
	return /authorization|api[-_]?key|token|secret|cookie/i.test(name);
}

function sanitizeCustomModelsConfig(config: CustomModelsConfig): CustomModelsConfig {
	return {
		providers: Object.fromEntries(
			Object.entries(config.providers).map(([provider, providerConfig]) => {
				const { apiKey: _apiKey, headers, ...safeConfig } = providerConfig;
				return [
					provider,
					{
						...safeConfig,
						...(headers
							? {
									headers: Object.fromEntries(
										Object.entries(headers).map(([name, value]) => [
											name,
											isSensitiveHeader(name) ? REDACTED_CONFIG_VALUE : value,
										]),
									),
								}
							: {}),
					},
				];
			}),
		),
	};
}

function mergeRedactedHeaders(
	incoming: Record<string, string> | undefined,
	existing: Record<string, string> | undefined,
): Record<string, string> | undefined {
	if (!incoming) return undefined;
	const existingByName = new Map(Object.entries(existing || {}).map(([name, value]) => [name.toLowerCase(), value]));
	return Object.fromEntries(
		Object.entries(incoming).map(([name, value]) => [
			name,
			value === REDACTED_CONFIG_VALUE ? existingByName.get(name.toLowerCase()) || value : value,
		]),
	);
}

function validateImportedCustomModels(providers: Record<string, unknown>): CustomModelsConfig {
	const entries = Object.entries(providers);
	if (entries.length > 100) throw new Error("A backup may contain at most 100 providers");
	const validated: CustomModelsConfig = { providers: {} };
	let modelCount = 0;
	for (const [rawProvider, rawConfig] of entries) {
		const provider = normalizeProviderId(rawProvider);
		if (
			!provider ||
			provider !== rawProvider ||
			!rawConfig ||
			typeof rawConfig !== "object" ||
			Array.isArray(rawConfig)
		) {
			throw new Error(`Invalid provider entry: ${rawProvider}`);
		}
		const config = rawConfig as Record<string, unknown>;
		const baseUrl = typeof config.baseUrl === "string" ? config.baseUrl.trim() : "";
		let parsedUrl: URL;
		try {
			parsedUrl = new URL(baseUrl);
		} catch {
			throw new Error(`Invalid base URL for provider ${provider}`);
		}
		if (!["http:", "https:"].includes(parsedUrl.protocol)) {
			throw new Error(`Base URL for provider ${provider} must use HTTP or HTTPS`);
		}
		const api = config.api;
		if (api !== "openai-completions" && api !== "anthropic-messages") {
			throw new Error(`Invalid API protocol for provider ${provider}`);
		}
		let headers: Record<string, string> | undefined;
		if (config.headers !== undefined) {
			if (!config.headers || typeof config.headers !== "object" || Array.isArray(config.headers)) {
				throw new Error(`Invalid headers for provider ${provider}`);
			}
			const headerEntries = Object.entries(config.headers);
			if (headerEntries.length > 50) throw new Error(`Too many headers for provider ${provider}`);
			headers = Object.fromEntries(
				headerEntries.map(([name, value]) => {
					if (!name.trim() || typeof value !== "string" || name.length > 200 || value.length > 4000) {
						throw new Error(`Invalid header for provider ${provider}`);
					}
					if (isSensitiveHeader(name) || value === REDACTED_CONFIG_VALUE) {
						throw new Error(`Backup files cannot contain credentials (${provider}: ${name})`);
					}
					return [name, value];
				}),
			);
		}
		if (!Array.isArray(config.models) || config.models.length === 0 || config.models.length > 200) {
			throw new Error(`Provider ${provider} must contain between 1 and 200 models`);
		}
		const models = config.models.map((rawModel) => {
			if (!rawModel || typeof rawModel !== "object" || Array.isArray(rawModel)) {
				throw new Error(`Invalid model for provider ${provider}`);
			}
			const model = rawModel as Record<string, unknown>;
			const id = typeof model.id === "string" ? model.id.trim() : "";
			const contextWindow = Number(model.contextWindow ?? 128000);
			const maxTokens = Number(model.maxTokens ?? 16384);
			if (!id || id.length > 300) throw new Error(`Invalid model id for provider ${provider}`);
			if (
				!Number.isFinite(contextWindow) ||
				!Number.isFinite(maxTokens) ||
				contextWindow <= 0 ||
				maxTokens <= 0 ||
				maxTokens > contextWindow
			) {
				throw new Error(`Invalid token limits for ${provider}/${id}`);
			}
			const input = Array.isArray(model.input) ? model.input : ["text"];
			if (input.some((value) => value !== "text" && value !== "image")) {
				throw new Error(`Invalid input capabilities for ${provider}/${id}`);
			}
			modelCount += 1;
			if (modelCount > 500) throw new Error("A backup may contain at most 500 models");
			return {
				id,
				...(typeof model.name === "string" && model.name.trim() ? { name: model.name.trim().slice(0, 300) } : {}),
				api,
				reasoning: Boolean(model.reasoning),
				input: [...new Set(input)] as ("text" | "image")[],
				contextWindow,
				maxTokens,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			};
		});
		validated.providers[provider] = {
			baseUrl: parsedUrl.toString().replace(/\/$/, ""),
			api,
			...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
			models,
		};
	}
	return validated;
}

function readCustomModelsConfig(): CustomModelsConfig {
	const path = getModelsPath();
	if (!existsSync(path)) {
		return { providers: {} };
	}
	const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<CustomModelsConfig>;
	return {
		providers: parsed.providers && typeof parsed.providers === "object" ? parsed.providers : {},
	};
}

function writeCustomModelsConfig(config: CustomModelsConfig): void {
	const path = getModelsPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
}

function normalizeProviderId(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function classifyConnectionError(
	message: string,
): "auth" | "endpoint" | "model" | "rate_limit" | "timeout" | "protocol" | "unknown" {
	const text = message.toLowerCase();
	if (/401|403|api.?key|unauthori[sz]ed|forbidden|authentication/.test(text)) return "auth";
	if (/404|not found|enotfound|econnrefused|network|fetch failed|dns/.test(text)) return "endpoint";
	if (/model.*(not found|invalid|unknown|does not exist)|invalid.*model/.test(text)) return "model";
	if (/429|rate.?limit|too many requests|quota/.test(text)) return "rate_limit";
	if (/timeout|timed out|aborted/.test(text)) return "timeout";
	if (/json|schema|parse|unexpected response|content-type|protocol/.test(text)) return "protocol";
	return "unknown";
}

async function testModelConnection(
	model: Model<Api>,
	auth: { apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> },
): Promise<{
	ok: boolean;
	latencyMs: number;
	category?: "auth" | "endpoint" | "model" | "rate_limit" | "timeout" | "protocol" | "unknown";
	message?: string;
}> {
	const startedAt = Date.now();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 20000);
	try {
		const response = await completeSimple(
			model,
			{ messages: [{ role: "user", content: "Reply with OK.", timestamp: Date.now() }] },
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				env: auth.env,
				signal: controller.signal,
				timeoutMs: 20000,
				maxRetries: 0,
			},
		);
		const latencyMs = Date.now() - startedAt;
		if (response.stopReason === "error" || response.stopReason === "aborted") {
			const message = response.errorMessage || `Request ended with ${response.stopReason}`;
			return { ok: false, latencyMs, category: classifyConnectionError(message), message };
		}
		return { ok: true, latencyMs };
	} catch (connectionError: unknown) {
		const message = connectionError instanceof Error ? connectionError.message : String(connectionError);
		return {
			ok: false,
			latencyMs: Date.now() - startedAt,
			category: classifyConnectionError(message),
			message,
		};
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events and responses on stdout.
 */
export async function runRpcMode(runtimeHost: AgentSessionRuntime): Promise<never> {
	takeOverStdout();
	let session = runtimeHost.session;
	let unsubscribe: (() => void) | undefined;
	let unsubscribeBackpressure: (() => void) | undefined;

	const output = (obj: RpcResponse | RpcExtensionUIRequest | object) => {
		writeRawStdout(serializeJsonLine(obj));
	};

	const success = <T extends RpcCommand["type"]>(
		id: string | undefined,
		command: T,
		data?: object | null,
	): RpcResponse => {
		if (data === undefined) {
			return { id, type: "response", command, success: true } as RpcResponse;
		}
		return { id, type: "response", command, success: true, data } as RpcResponse;
	};

	const error = (id: string | undefined, command: string, message: string): RpcResponse => {
		return { id, type: "response", command, success: false, error: message };
	};

	// Pending extension UI requests waiting for response
	const pendingExtensionRequests = new Map<
		string,
		{ resolve: (value: any) => void; reject: (error: Error) => void }
	>();

	// Shutdown request flag
	let shutdownRequested = false;
	let shuttingDown = false;
	const signalCleanupHandlers: Array<() => void> = [];

	/** Helper for dialog methods with signal/timeout support */
	function createDialogPromise<T>(
		opts: ExtensionUIDialogOptions | undefined,
		defaultValue: T,
		request: Record<string, unknown>,
		parseResponse: (response: RpcExtensionUIResponse) => T,
	): Promise<T> {
		if (opts?.signal?.aborted) return Promise.resolve(defaultValue);

		const id = crypto.randomUUID();
		return new Promise((resolve, reject) => {
			let timeoutId: ReturnType<typeof setTimeout> | undefined;

			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				opts?.signal?.removeEventListener("abort", onAbort);
				pendingExtensionRequests.delete(id);
			};

			const onAbort = () => {
				cleanup();
				resolve(defaultValue);
			};
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			if (opts?.timeout) {
				timeoutId = setTimeout(() => {
					cleanup();
					resolve(defaultValue);
				}, opts.timeout);
			}

			pendingExtensionRequests.set(id, {
				resolve: (response: RpcExtensionUIResponse) => {
					cleanup();
					resolve(parseResponse(response));
				},
				reject,
			});
			output({ type: "extension_ui_request", id, ...request } as RpcExtensionUIRequest);
		});
	}

	/**
	 * Create an extension UI context that uses the RPC protocol.
	 */
	const createExtensionUIContext = (): ExtensionUIContext => ({
		select: (title, options, opts) =>
			createDialogPromise(opts, undefined, { method: "select", title, options, timeout: opts?.timeout }, (r) =>
				"cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
			),

		confirm: (title, message, opts) =>
			createDialogPromise(opts, false, { method: "confirm", title, message, timeout: opts?.timeout }, (r) =>
				"cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false,
			),

		input: (title, placeholder, opts) =>
			createDialogPromise(opts, undefined, { method: "input", title, placeholder, timeout: opts?.timeout }, (r) =>
				"cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
			),

		notify(message: string, type?: "info" | "warning" | "error"): void {
			// Fire and forget - no response needed
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "notify",
				message,
				notifyType: type,
			} as RpcExtensionUIRequest);
		},

		onTerminalInput(): () => void {
			// Raw terminal input not supported in RPC mode
			return () => {};
		},

		setStatus(key: string, text: string | undefined): void {
			// Fire and forget - no response needed
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setStatus",
				statusKey: key,
				statusText: text,
			} as RpcExtensionUIRequest);
		},

		setWorkingMessage(_message?: string): void {
			// Working message not supported in RPC mode - requires TUI loader access
		},

		setWorkingVisible(_visible: boolean): void {
			// Working visibility not supported in RPC mode - requires TUI loader access
		},

		setWorkingIndicator(_options?: WorkingIndicatorOptions): void {
			// Working indicator customization not supported in RPC mode - requires TUI loader access
		},

		setHiddenThinkingLabel(_label?: string): void {
			// Hidden thinking label not supported in RPC mode - requires TUI message rendering access
		},

		setWidget(key: string, content: unknown, options?: ExtensionWidgetOptions): void {
			// Only support string arrays in RPC mode - factory functions are ignored
			if (content === undefined || Array.isArray(content)) {
				output({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setWidget",
					widgetKey: key,
					widgetLines: content as string[] | undefined,
					widgetPlacement: options?.placement,
				} as RpcExtensionUIRequest);
			}
			// Component factories are not supported in RPC mode - would need TUI access
		},

		setFooter(_factory: unknown): void {
			// Custom footer not supported in RPC mode - requires TUI access
		},

		setHeader(_factory: unknown): void {
			// Custom header not supported in RPC mode - requires TUI access
		},

		setTitle(title: string): void {
			// Fire and forget - host can implement terminal title control
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setTitle",
				title,
			} as RpcExtensionUIRequest);
		},

		async custom() {
			// Custom UI not supported in RPC mode
			return undefined as never;
		},

		pasteToEditor(text: string): void {
			// Paste handling not supported in RPC mode - falls back to setEditorText
			this.setEditorText(text);
		},

		setEditorText(text: string): void {
			// Fire and forget - host can implement editor control
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "set_editor_text",
				text,
			} as RpcExtensionUIRequest);
		},

		getEditorText(): string {
			// Synchronous method can't wait for RPC response
			// Host should track editor state locally if needed
			return "";
		},

		async editor(title: string, prefill?: string): Promise<string | undefined> {
			const id = crypto.randomUUID();
			return new Promise((resolve, reject) => {
				pendingExtensionRequests.set(id, {
					resolve: (response: RpcExtensionUIResponse) => {
						if ("cancelled" in response && response.cancelled) {
							resolve(undefined);
						} else if ("value" in response) {
							resolve(response.value);
						} else {
							resolve(undefined);
						}
					},
					reject,
				});
				output({ type: "extension_ui_request", id, method: "editor", title, prefill } as RpcExtensionUIRequest);
			});
		},

		addAutocompleteProvider(): void {
			// Autocomplete provider composition is not supported in RPC mode
		},

		setEditorComponent(): void {
			// Custom editor components not supported in RPC mode
		},

		getEditorComponent() {
			// Custom editor components not supported in RPC mode
			return undefined;
		},

		get theme() {
			return theme;
		},

		getAllThemes() {
			return [];
		},

		getTheme(_name: string) {
			return undefined;
		},

		setTheme(_theme: string | Theme) {
			// Theme switching not supported in RPC mode
			return { success: false, error: "Theme switching not supported in RPC mode" };
		},

		getToolsExpanded() {
			// Tool expansion not supported in RPC mode - no TUI
			return false;
		},

		setToolsExpanded(_expanded: boolean) {
			// Tool expansion not supported in RPC mode - no TUI
		},
	});

	runtimeHost.setRebindSession(async () => {
		await rebindSession();
	});

	const rebindSession = async (): Promise<void> => {
		session = runtimeHost.session;
		await session.bindExtensions({
			uiContext: createExtensionUIContext(),
			mode: "rpc",
			commandContextActions: {
				waitForIdle: () => session.agent.waitForIdle(),
				newSession: async (options) => runtimeHost.newSession(options),
				fork: async (entryId, forkOptions) => {
					const result = await runtimeHost.fork(entryId, forkOptions);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, options) => {
					const result = await session.navigateTree(targetId, {
						summarize: options?.summarize,
						customInstructions: options?.customInstructions,
						replaceInstructions: options?.replaceInstructions,
						label: options?.label,
					});
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath, options) => {
					return runtimeHost.switchSession(sessionPath, options);
				},
				reload: async () => {
					await session.reload();
				},
			},
			shutdownHandler: () => {
				shutdownRequested = true;
			},
			onError: (err) => {
				output({ type: "extension_error", extensionPath: err.extensionPath, event: err.event, error: err.error });
			},
		});

		unsubscribe?.();
		unsubscribeBackpressure?.();
		unsubscribe = session.subscribe((event) => {
			output(event);
		});
		unsubscribeBackpressure = session.agent.subscribe(async () => {
			await waitForRawStdoutBackpressure();
		});
	};

	const registerSignalHandlers = (): void => {
		const signals: NodeJS.Signals[] = ["SIGTERM"];
		if (process.platform !== "win32") {
			signals.push("SIGHUP");
		}

		for (const signal of signals) {
			const handler = () => {
				killTrackedDetachedChildren();
				void shutdown(signal === "SIGHUP" ? 129 : 143, signal);
			};
			process.on(signal, handler);
			signalCleanupHandlers.push(() => process.off(signal, handler));
		}
	};

	await rebindSession();
	registerSignalHandlers();

	// Handle a single command
	const handleCommand = async (command: RpcCommand): Promise<RpcResponse | undefined> => {
		const id = command.id;

		switch (command.type) {
			// =================================================================
			// Prompting
			// =================================================================

			case "prompt": {
				// Start prompt handling immediately, but emit the authoritative response only after
				// prompt preflight succeeds. Queued and immediately handled prompts also count as success.
				let preflightSucceeded = false;
				void session
					.prompt(command.message, {
						images: command.images,
						streamingBehavior: command.streamingBehavior,
						source: "rpc",
						preflightResult: (didSucceed) => {
							if (didSucceed) {
								preflightSucceeded = true;
								output(success(id, "prompt"));
							}
						},
					})
					.catch((e) => {
						if (!preflightSucceeded) {
							output(error(id, "prompt", e.message));
						}
					});
				return undefined;
			}

			case "steer": {
				await session.steer(command.message, command.images);
				return success(id, "steer");
			}

			case "follow_up": {
				await session.followUp(command.message, command.images);
				return success(id, "follow_up");
			}

			case "abort": {
				await session.abort();
				return success(id, "abort");
			}

			case "new_session": {
				const options = command.parentSession ? { parentSession: command.parentSession } : undefined;
				const result = await runtimeHost.newSession(options);
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "new_session", result);
			}

			// =================================================================
			// State
			// =================================================================

			case "get_state": {
				const state = {
					model: session.model,
					thinkingLevel: session.thinkingLevel,
					isStreaming: session.isStreaming,
					isCompacting: session.isCompacting,
					steeringMode: session.steeringMode,
					followUpMode: session.followUpMode,
					sessionFile: session.sessionFile,
					sessionId: session.sessionId,
					sessionName: session.sessionName,
					autoCompactionEnabled: session.autoCompactionEnabled,
					messageCount: session.messages.length,
					pendingMessageCount: session.pendingMessageCount,
				} satisfies RpcSessionState satisfies RpcSessionStateDTO;
				return success(id, "get_state", state);
			}

			// =================================================================
			// Model
			// =================================================================

			case "set_model": {
				const models = await session.modelRegistry.getAvailable();
				const model = models.find((m) => m.provider === command.provider && m.id === command.modelId);
				if (!model) {
					return error(id, "set_model", `Model not found: ${command.provider}/${command.modelId}`);
				}
				await session.setModel(model);
				return success(id, "set_model", model);
			}

			case "cycle_model": {
				const result = await session.cycleModel();
				if (!result) {
					return success(id, "cycle_model", null);
				}
				return success(id, "cycle_model", result);
			}

			case "get_available_models": {
				const models = await session.modelRegistry.getAvailable();
				return success(id, "get_available_models", { models } satisfies RpcGetAvailableModelsDataDTO);
			}

			case "get_auth_status": {
				const providers =
					command.providers && command.providers.length > 0
						? command.providers
						: [...new Set((await session.modelRegistry.getAvailable()).map((model) => model.provider))];
				const statuses = Object.fromEntries(
					providers.map((provider) => [provider, session.modelRegistry.getProviderAuthStatus(provider)]),
				);
				return success(id, "get_auth_status", { providers: statuses } satisfies RpcGetAuthStatusDataDTO);
			}

			case "set_api_key": {
				const provider = command.provider.trim();
				const apiKey = command.apiKey.trim();
				if (!provider) {
					return error(id, "set_api_key", "Provider is required");
				}
				if (!apiKey) {
					return error(id, "set_api_key", "API key is required");
				}
				session.modelRegistry.authStorage.set(provider, { type: "api_key", key: apiKey });
				return success(id, "set_api_key", {
					provider,
					status: session.modelRegistry.getProviderAuthStatus(provider),
				});
			}

			case "remove_api_key": {
				const provider = command.provider.trim();
				if (!provider) {
					return error(id, "remove_api_key", "Provider is required");
				}
				session.modelRegistry.authStorage.remove(provider);
				return success(id, "remove_api_key", {
					provider,
					status: session.modelRegistry.getProviderAuthStatus(provider),
				});
			}

			case "get_custom_models": {
				const config = readCustomModelsConfig();
				return success(id, "get_custom_models", {
					path: getModelsPath(),
					providers: sanitizeCustomModelsConfig(config).providers,
				} satisfies RpcGetCustomModelsDataDTO);
			}

			case "replace_custom_models": {
				const config = validateImportedCustomModels(command.providers);
				writeCustomModelsConfig(config);
				session.modelRegistry.refresh();
				const models = Object.values(config.providers).reduce(
					(count, provider) => count + (provider.models?.length || 0),
					0,
				);
				return success(id, "replace_custom_models", {
					path: getModelsPath(),
					providers: Object.keys(config.providers).length,
					models,
				});
			}

			case "test_model": {
				const provider = normalizeProviderId(command.provider);
				const model = session.modelRegistry.find(provider, command.modelId.trim());
				if (!model) {
					return success(id, "test_model", {
						ok: false,
						latencyMs: 0,
						category: "model" as const,
						message: `Model not found: ${provider}/${command.modelId.trim()}`,
					});
				}
				const auth = await session.modelRegistry.getApiKeyAndHeaders(model);
				if (!auth.ok || !auth.apiKey) {
					return success(id, "test_model", {
						ok: false,
						latencyMs: 0,
						category: "auth" as const,
						message: auth.ok ? `No API key found for "${provider}"` : auth.error,
					});
				}
				return success(id, "test_model", await testModelConnection(model, auth));
			}

			case "test_custom_model": {
				const provider = normalizeProviderId(command.provider);
				const modelId = command.modelId.trim();
				let baseUrl: URL;
				try {
					baseUrl = new URL(command.baseUrl.trim());
				} catch {
					return success(id, "test_custom_model", {
						ok: false,
						latencyMs: 0,
						category: "endpoint" as const,
						message: "Base URL is not a valid URL",
					});
				}
				if (!provider || !modelId || !["http:", "https:"].includes(baseUrl.protocol)) {
					return success(id, "test_custom_model", {
						ok: false,
						latencyMs: 0,
						category: "endpoint" as const,
						message:
							!provider || !modelId ? "Provider and model id are required" : "Base URL must use HTTP or HTTPS",
					});
				}

				const model: Model<"openai-completions" | "anthropic-messages"> = {
					id: modelId,
					name: modelId,
					api: command.api,
					provider,
					baseUrl: baseUrl.toString().replace(/\/$/, ""),
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 4096,
					maxTokens: 8,
				};
				const preservedProvider = command.preserveHeadersFromProvider
					? readCustomModelsConfig().providers[normalizeProviderId(command.preserveHeadersFromProvider)]
					: undefined;
				const headers = mergeRedactedHeaders(command.headers, preservedProvider?.headers);
				let apiKey = command.apiKey?.trim() || undefined;
				let env: Record<string, string> | undefined;
				let storedHeaders: Record<string, string> | undefined;
				if (!apiKey && command.useStoredAuthProvider) {
					const storedAuth = await session.modelRegistry.getApiKeyAndHeaders(model);
					if (storedAuth.ok) {
						apiKey = storedAuth.apiKey;
						env = storedAuth.env;
						storedHeaders = storedAuth.headers;
					}
				}
				return success(
					id,
					"test_custom_model",
					await testModelConnection(model, {
						apiKey,
						headers: storedHeaders || headers ? { ...storedHeaders, ...headers } : undefined,
						env,
					}),
				);
			}

			case "upsert_custom_model": {
				const provider = normalizeProviderId(command.provider);
				const baseUrl = command.baseUrl.trim();
				const modelId = command.model.id.trim();
				const modelName = command.model.name?.trim();
				if (!provider) {
					return error(id, "upsert_custom_model", "Provider id is required");
				}
				if (!baseUrl) {
					return error(id, "upsert_custom_model", "Base URL is required");
				}
				if (!modelId) {
					return error(id, "upsert_custom_model", "Model id is required");
				}

				const config = readCustomModelsConfig();
				const providerConfig = config.providers[provider] ?? {};
				const { headers: _oldHeaders, ...providerConfigWithoutHeaders } = providerConfig;
				const existingModels = Array.isArray(providerConfig.models) ? providerConfig.models : [];
				const incomingHeaders =
					command.headers && typeof command.headers === "object"
						? Object.fromEntries(
								Object.entries(command.headers).filter(
									([key, value]) => key.trim() && typeof value === "string",
								),
							)
						: undefined;
				const headers = mergeRedactedHeaders(incomingHeaders, _oldHeaders);
				const input: ("text" | "image")[] = command.model.input?.length ? command.model.input : ["text"];
				const model = {
					id: modelId,
					...(modelName ? { name: modelName } : {}),
					api: command.api,
					reasoning: Boolean(command.model.reasoning),
					input,
					contextWindow:
						command.model.contextWindow && command.model.contextWindow > 0 ? command.model.contextWindow : 128000,
					maxTokens: command.model.maxTokens && command.model.maxTokens > 0 ? command.model.maxTokens : 16384,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				};

				config.providers[provider] = {
					...providerConfigWithoutHeaders,
					baseUrl,
					...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
					api: command.api,
					models: [
						...existingModels.filter((item) => item.id !== modelId && item.id !== command.replaceModelId?.trim()),
						model,
					],
				};
				writeCustomModelsConfig(config);
				if (command.apiKey?.trim()) {
					session.modelRegistry.authStorage.set(provider, { type: "api_key", key: command.apiKey.trim() });
				}
				session.modelRegistry.refresh();
				return success(id, "upsert_custom_model", { path: getModelsPath(), provider, modelId });
			}

			case "remove_custom_model": {
				const provider = normalizeProviderId(command.provider);
				const modelId = command.modelId.trim();
				if (!provider || !modelId) {
					return error(id, "remove_custom_model", "Provider and model id are required");
				}
				const config = readCustomModelsConfig();
				const providerConfig = config.providers[provider];
				if (providerConfig?.models) {
					providerConfig.models = providerConfig.models.filter((model) => model.id !== modelId);
					if (providerConfig.models.length === 0) {
						delete config.providers[provider];
						if (command.removeAuthWhenEmpty) {
							session.modelRegistry.authStorage.remove(provider);
						}
					}
					writeCustomModelsConfig(config);
					session.modelRegistry.refresh();
				}
				return success(id, "remove_custom_model", { path: getModelsPath(), provider, modelId });
			}

			// =================================================================
			// Thinking
			// =================================================================

			case "set_thinking_level": {
				session.setThinkingLevel(command.level);
				return success(id, "set_thinking_level");
			}

			case "cycle_thinking_level": {
				const level = session.cycleThinkingLevel();
				if (!level) {
					return success(id, "cycle_thinking_level", null);
				}
				return success(id, "cycle_thinking_level", { level });
			}

			// =================================================================
			// Queue Modes
			// =================================================================

			case "set_steering_mode": {
				session.setSteeringMode(command.mode);
				return success(id, "set_steering_mode");
			}

			case "set_extension_flag": {
				session.setExtensionFlag(command.name, command.value);
				return success(id, "set_extension_flag");
			}

			case "set_follow_up_mode": {
				session.setFollowUpMode(command.mode);
				return success(id, "set_follow_up_mode");
			}

			// =================================================================
			// Compaction
			// =================================================================

			case "compact": {
				const result = await session.compact(command.customInstructions);
				return success(id, "compact", result);
			}

			case "set_auto_compaction": {
				session.setAutoCompactionEnabled(command.enabled);
				return success(id, "set_auto_compaction");
			}

			// =================================================================
			// Retry
			// =================================================================

			case "set_auto_retry": {
				session.setAutoRetryEnabled(command.enabled);
				return success(id, "set_auto_retry");
			}

			case "abort_retry": {
				session.abortRetry();
				return success(id, "abort_retry");
			}

			// =================================================================
			// Bash
			// =================================================================

			case "bash": {
				const result = await session.executeBash(command.command, undefined, {
					excludeFromContext: command.excludeFromContext,
				});
				return success(id, "bash", result);
			}

			case "abort_bash": {
				session.abortBash();
				return success(id, "abort_bash");
			}

			// =================================================================
			// Session
			// =================================================================

			case "get_session_stats": {
				const stats = session.getSessionStats();
				return success(id, "get_session_stats", stats satisfies RpcSessionStatsDTO);
			}

			case "export_html": {
				const path = await session.exportToHtml(command.outputPath);
				return success(id, "export_html", { path });
			}

			case "get_sessions": {
				const limit = Math.max(1, Math.min(command.limit ?? 40, 200));
				const sessions = command.all
					? await SessionManager.listAll(session.sessionManager.getSessionDir())
					: await SessionManager.list(session.sessionManager.getCwd(), session.sessionManager.getSessionDir());
				// Not `satisfies RpcGetSessionsDataDTO`: SessionInfo.created/modified are Date
				// instances here that serialize to ISO strings on the wire, so the in-memory
				// object intentionally doesn't match the (post-serialization) DTO.
				return success(id, "get_sessions", { sessions: sessions.slice(0, limit) });
			}

			case "switch_session": {
				const result = await runtimeHost.switchSession(command.sessionPath);
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "switch_session", result);
			}

			case "fork": {
				const result = await runtimeHost.fork(command.entryId);
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "fork", { text: result.selectedText, cancelled: result.cancelled });
			}

			case "clone": {
				const leafId = session.sessionManager.getLeafId();
				if (!leafId) {
					return error(id, "clone", "Cannot clone session: no current entry selected");
				}
				const result = await runtimeHost.fork(leafId, { position: "at" });
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "clone", { cancelled: result.cancelled });
			}

			case "get_fork_messages": {
				const messages = session.getUserMessagesForForking();
				return success(id, "get_fork_messages", { messages });
			}

			case "get_entries": {
				const sessionManager = session.sessionManager;
				let entries = sessionManager.getEntries();
				if (command.since !== undefined) {
					const sinceIndex = entries.findIndex((e) => e.id === command.since);
					if (sinceIndex === -1) {
						return error(id, "get_entries", `Entry not found: ${command.since}`);
					}
					entries = entries.slice(sinceIndex + 1);
				}
				return success(id, "get_entries", { entries, leafId: sessionManager.getLeafId() });
			}

			case "get_tree": {
				const sessionManager = session.sessionManager;
				return success(id, "get_tree", { tree: sessionManager.getTree(), leafId: sessionManager.getLeafId() });
			}

			case "get_last_assistant_text": {
				const text = session.getLastAssistantText();
				return success(id, "get_last_assistant_text", { text });
			}

			case "set_session_name": {
				const name = command.name.trim();
				if (!name) {
					return error(id, "set_session_name", "Session name cannot be empty");
				}
				session.setSessionName(name);
				return success(id, "set_session_name");
			}

			// =================================================================
			// Messages
			// =================================================================

			case "get_messages": {
				return success(id, "get_messages", { messages: session.messages } satisfies RpcGetMessagesDataDTO);
			}

			// =================================================================
			// Commands (available for invocation via prompt)
			// =================================================================

			case "get_commands": {
				const commands: RpcSlashCommand[] = [];

				for (const command of session.extensionRunner.getRegisteredCommands()) {
					commands.push({
						name: command.invocationName,
						description: command.description,
						source: "extension",
						sourceInfo: command.sourceInfo,
					});
				}

				for (const template of session.promptTemplates) {
					commands.push({
						name: template.name,
						description: template.description,
						source: "prompt",
						sourceInfo: template.sourceInfo,
					});
				}

				for (const skill of session.resourceLoader.getSkills().skills) {
					commands.push({
						name: `skill:${skill.name}`,
						description: skill.description,
						source: "skill",
						sourceInfo: skill.sourceInfo,
					});
				}

				return success(id, "get_commands", { commands } satisfies RpcGetCommandsDataDTO);
			}

			default: {
				const unknownCommand = command as { type: string };
				return error(id, unknownCommand.type, `Unknown command: ${unknownCommand.type}`);
			}
		}
	};

	/**
	 * Check if shutdown was requested and perform shutdown if so.
	 * Called after handling each command when waiting for the next command.
	 */
	let detachInput = () => {};

	async function shutdown(exitCode = 0, signal?: NodeJS.Signals): Promise<never> {
		if (shuttingDown) {
			process.exit(exitCode);
		}
		shuttingDown = true;
		for (const cleanup of signalCleanupHandlers) {
			cleanup();
		}
		unsubscribe?.();
		unsubscribeBackpressure?.();
		await runtimeHost.dispose();
		detachInput();
		process.stdin.pause();
		if (signal !== "SIGTERM") {
			await flushRawStdout();
		}
		process.exit(exitCode);
	}

	async function checkShutdownRequested(): Promise<void> {
		if (!shutdownRequested) return;
		await shutdown();
	}

	const handleInputLine = async (line: string) => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (parseError: unknown) {
			output(
				error(
					undefined,
					"parse",
					`Failed to parse command: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
				),
			);
			await waitForRawStdoutBackpressure();
			return;
		}

		// Handle extension UI responses
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"type" in parsed &&
			parsed.type === "extension_ui_response"
		) {
			const response = parsed as RpcExtensionUIResponse;
			const pending = pendingExtensionRequests.get(response.id);
			if (pending) {
				pendingExtensionRequests.delete(response.id);
				pending.resolve(response);
			}
			return;
		}

		const command = parsed as RpcCommand;
		try {
			const response = await handleCommand(command);
			if (response) {
				output(response);
				await waitForRawStdoutBackpressure();
			}
			await checkShutdownRequested();
		} catch (commandError: unknown) {
			output(
				error(
					command.id,
					command.type,
					commandError instanceof Error ? commandError.message : String(commandError),
				),
			);
			await waitForRawStdoutBackpressure();
		}
	};

	const onInputEnd = () => {
		void shutdown();
	};
	process.stdin.on("end", onInputEnd);

	detachInput = (() => {
		const detachJsonl = attachJsonlLineReader(process.stdin, (line) => {
			void handleInputLine(line);
		});
		return () => {
			detachJsonl();
			process.stdin.off("end", onInputEnd);
		};
	})();

	// Keep process alive forever
	return new Promise(() => {});
}
