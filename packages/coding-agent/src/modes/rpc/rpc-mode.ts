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
import { contentText } from "@earendil-works/pi-ai";
import { type Api, completeSimple, type Model } from "@earendil-works/pi-ai/compat";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { getAgentDir, getModelsPath } from "../../config.ts";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	ReplacedSessionContext,
	WorkingIndicatorOptions,
} from "../../core/extensions/index.ts";
import {
	appendMemoryContext,
	collectMemoryConversation,
	ensureSessionMemorySettings,
	formatMemoryContext,
	MEMORY_CONTEXT_CUSTOM_TYPE,
	MemoryStore,
	parseMemoryCandidates,
	sessionHasMemoryContext,
	sessionHasUserMessage,
	setSessionMemorySettings,
} from "../../core/memory-store.ts";
import {
	flushRawStdout,
	takeOverStdout,
	waitForRawStdoutBackpressure,
	writeRawStdout,
} from "../../core/output-guard.ts";
import { DefaultPackageManager } from "../../core/package-manager.ts";
import { type SessionInfo, SessionManager, type SessionTreeNode } from "../../core/session-manager.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../../core/trust-manager.ts";
import { killTrackedDetachedChildren } from "../../utils/shell.ts";
import { type Theme, theme } from "../interactive/theme/theme.ts";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.ts";
import { loadResourceCatalog } from "./resource-catalog.ts";
import type {
	RpcExtensionErrorEventDTO,
	RpcFetchProviderModelsDataDTO,
	RpcForkResultDTO,
	RpcGetAuthStatusDataDTO,
	RpcGetAvailableModelsDataDTO,
	RpcGetCommandsDataDTO,
	RpcGetCustomModelsDataDTO,
	RpcGetMessagesDataDTO,
	RpcGetSessionsDataDTO,
	RpcImageGenerationSettingsDataDTO,
	RpcMemorySettingsDataDTO,
	RpcResetMemoriesDataDTO,
	RpcSessionChangedEventDTO,
	RpcSessionStateDTO,
	RpcSessionStatsDTO,
	RpcSessionTreeNodeDTO,
} from "./rpc-desktop-contract.ts";
import type {
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIRequestClosed,
	RpcExtensionUIResponse,
	RpcResponse,
	RpcSessionState,
	RpcSlashCommand,
} from "./rpc-types.ts";
import { getSessionPage } from "./session-list-query.ts";

// Re-export types for consumers
export type {
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIRequestClosed,
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
			env?: Record<string, string>;
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
const PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY"] as const;

function isSensitiveHeader(name: string): boolean {
	return /authorization|api[-_]?key|token|secret|cookie/i.test(name);
}

function definedHeaders(
	headers: Record<string, string | null | undefined> | undefined,
): Record<string, string> | undefined {
	if (!headers) return undefined;
	const entries = Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === "string");
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function getProxyUrlFromEnv(env: Record<string, string> | undefined): string | undefined {
	return env?.HTTPS_PROXY || env?.HTTP_PROXY || undefined;
}

function mergeProxyEnv(
	existing: Record<string, string> | undefined,
	proxyUrl: string | undefined,
): Record<string, string> | undefined {
	if (proxyUrl === undefined) return existing;
	const normalized = proxyUrl.trim();
	if (normalized) {
		let parsed: URL;
		try {
			parsed = new URL(normalized);
		} catch {
			throw new Error("Proxy URL is not a valid URL");
		}
		if (!["http:", "https:"].includes(parsed.protocol)) {
			throw new Error("Proxy URL must use HTTP or HTTPS");
		}
		return {
			...(existing ?? {}),
			HTTP_PROXY: parsed.toString(),
			HTTPS_PROXY: parsed.toString(),
		};
	}

	const next = { ...(existing ?? {}) };
	for (const key of PROXY_ENV_KEYS) {
		delete next[key];
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

function sanitizeCustomModelsConfig(
	config: CustomModelsConfig,
	getProviderMetadata?: (provider: string) => {
		authKind: "api_key" | "none";
		hasStoredAuth: boolean;
		proxyUrl?: string;
	},
): CustomModelsConfig {
	return {
		providers: Object.fromEntries(
			Object.entries(config.providers).map(([provider, providerConfig]) => {
				const { apiKey: _apiKey, env: _env, headers, ...safeConfig } = providerConfig;
				const metadata = getProviderMetadata?.(provider);
				return [
					provider,
					{
						...safeConfig,
						...(metadata ? metadata : {}),
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

function toRpcSessionTreeNode(node: SessionTreeNode): RpcSessionTreeNodeDTO {
	const summary = "summary" in node.entry && typeof node.entry.summary === "string" ? node.entry.summary : undefined;
	const root: RpcSessionTreeNodeDTO = {
		entry: {
			type: node.entry.type,
			id: node.entry.id,
			parentId: node.entry.parentId,
			timestamp: node.entry.timestamp,
			...(summary ? { summary } : {}),
		},
		children: [],
		...(node.label !== undefined ? { label: node.label } : {}),
		...(node.labelTimestamp !== undefined ? { labelTimestamp: node.labelTimestamp } : {}),
	};
	const stack: Array<{ source: SessionTreeNode; target: RpcSessionTreeNodeDTO; nextChild: number }> = [
		{ source: node, target: root, nextChild: 0 },
	];
	while (stack.length > 0) {
		const frame = stack[stack.length - 1]!;
		const child = frame.source.children[frame.nextChild++];
		if (!child) {
			stack.pop();
			continue;
		}
		const childSummary =
			"summary" in child.entry && typeof child.entry.summary === "string" ? child.entry.summary : undefined;
		const childDto: RpcSessionTreeNodeDTO = {
			entry: {
				type: child.entry.type,
				id: child.entry.id,
				parentId: child.entry.parentId,
				timestamp: child.entry.timestamp,
				...(childSummary ? { summary: childSummary } : {}),
			},
			children: [],
			...(child.label !== undefined ? { label: child.label } : {}),
			...(child.labelTimestamp !== undefined ? { labelTimestamp: child.labelTimestamp } : {}),
		};
		frame.target.children.push(childDto);
		stack.push({ source: child, target: childDto, nextChild: 0 });
	}
	return root;
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

async function fetchRemoteProviderModels(params: {
	baseUrl: string;
	api: "openai-completions" | "anthropic-messages";
	apiKey?: string;
	headers?: Record<string, string>;
	env?: Record<string, string>;
}): Promise<RpcFetchProviderModelsDataDTO> {
	const trimmedBase = params.baseUrl.trim().replace(/\/+$/, "");
	if (!trimmedBase) {
		throw new Error("Base URL is required");
	}
	const base = new URL(trimmedBase);
	if (!["http:", "https:"].includes(base.protocol)) {
		throw new Error("Base URL must use HTTP or HTTPS");
	}

	const key = params.apiKey?.trim();
	const headers: Record<string, string> = {
		Accept: "application/json",
		...(params.headers ?? {}),
	};
	if (key) {
		if (params.api === "anthropic-messages") {
			headers["x-api-key"] ??= key;
			headers["anthropic-version"] ??= "2023-06-01";
		} else {
			headers.Authorization ??= `Bearer ${key}`;
		}
	}

	const stripped = trimmedBase.replace(/\/v1$/, "");
	const candidates = [...new Set([`${trimmedBase}/models`, `${stripped}/v1/models`])];
	const proxyUrl = getProxyUrlFromEnv(params.env);
	const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
	try {
		let lastError = "";
		for (const modelsUrl of candidates) {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 20000);
			let response: Awaited<ReturnType<typeof undiciFetch>>;
			try {
				response = await undiciFetch(modelsUrl, {
					method: "GET",
					headers,
					signal: controller.signal,
					...(dispatcher ? { dispatcher } : {}),
				});
			} catch (error) {
				clearTimeout(timeout);
				lastError = `Could not reach ${modelsUrl}: ${error instanceof Error ? error.message : String(error)}`;
				continue;
			}
			clearTimeout(timeout);

			if (!response.ok) {
				let detail = "";
				try {
					detail = (await response.text()).slice(0, 300);
				} catch {
					// ignore body read failures
				}
				lastError = `HTTP ${response.status} from ${modelsUrl}${detail ? `: ${detail}` : ""}`;
				continue;
			}

			let body: unknown;
			try {
				body = await response.json();
			} catch {
				lastError = `${modelsUrl} did not return valid JSON`;
				continue;
			}

			const rawList = Array.isArray(body)
				? body
				: body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
					? (body as { data: unknown[] }).data
					: undefined;
			if (!rawList) {
				lastError = `Unexpected response shape from ${modelsUrl} (no data array)`;
				continue;
			}
			const models = rawList
				.map((entry) => {
					if (typeof entry === "string") return { id: entry };
					if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
						const item = entry as { id: string; display_name?: unknown; name?: unknown };
						return {
							id: item.id,
							name:
								typeof item.display_name === "string"
									? item.display_name
									: typeof item.name === "string"
										? item.name
										: undefined,
						};
					}
					return undefined;
				})
				.filter((model): model is { id: string; name?: string } => Boolean(model?.id))
				.slice(0, 500);

			return { models };
		}

		throw new Error(lastError || "Could not fetch models from endpoint");
	} finally {
		await dispatcher?.close();
	}
}

/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events and responses on stdout.
 */
export async function runRpcMode(runtimeHost: AgentSessionRuntime): Promise<never> {
	takeOverStdout();
	let session = runtimeHost.session;
	const memoryStore = new MemoryStore();
	let memoryGenerationTail: Promise<void> = Promise.resolve();
	let unsubscribe: (() => void) | undefined;
	let unsubscribeBackpressure: (() => void) | undefined;
	let promptPreflightTail: Promise<void> = Promise.resolve();

	const output = (obj: RpcResponse | RpcExtensionUIRequest | RpcExtensionUIRequestClosed | object) => {
		writeRawStdout(serializeJsonLine(obj));
	};
	const ensureWithSessionCallback = (
		withSession?: (context: ReplacedSessionContext) => Promise<void>,
	): ((context: ReplacedSessionContext) => Promise<void>) => {
		return async (context) => withSession?.(context);
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

	const ensureMemorySettings = (target = session) => {
		const preferences = target.settingsManager.getMemorySettings();
		return ensureSessionMemorySettings(target.sessionManager, {
			useMemories: preferences.enabled,
			generateMemories: preferences.enabled,
		});
	};

	const hasSessionUserMessage = (target = session): boolean =>
		sessionHasUserMessage(target.sessionManager) || target.messages.some((message) => message.role === "user");

	const getMemorySettingsData = (target = session): RpcMemorySettingsDataDTO => {
		const preferences = target.settingsManager.getMemorySettings();
		const taskSettings = ensureMemorySettings(target);
		return {
			enabled: preferences.enabled,
			allowToolChats: preferences.allowToolChats,
			useMemories: taskSettings.useMemories,
			generateMemories: taskSettings.generateMemories,
			useMemoriesLocked: hasSessionUserMessage(target),
			count: memoryStore.read().length,
			path: memoryStore.filePath,
		};
	};

	const injectMemoryContext = (target = session): void => {
		const preferences = target.settingsManager.getMemorySettings();
		const taskSettings = ensureMemorySettings(target);
		if (!preferences.enabled || !taskSettings.useMemories) return;
		if (hasSessionUserMessage(target)) return;
		const memories = memoryStore.read();
		if (memories.length === 0 || sessionHasMemoryContext(target.sessionManager)) return;
		if (!appendMemoryContext(target.sessionManager, memories)) return;
		target.agent.state.messages.push({
			role: "custom",
			customType: MEMORY_CONTEXT_CUSTOM_TYPE,
			content: formatMemoryContext(memories),
			display: false,
			details: { count: memories.length },
			timestamp: Date.now(),
		});
	};

	const generateMemories = async (target: typeof session): Promise<void> => {
		const preferences = target.settingsManager.getMemorySettings();
		const taskSettings = ensureMemorySettings(target);
		if (!preferences.enabled || !taskSettings.generateMemories) return;
		const model = target.model;
		if (!model) return;
		const conversation = collectMemoryConversation(target.sessionManager);
		if (
			!conversation.text ||
			!target.sessionManager
				.getBranch()
				.some((entry) => entry.type === "message" && entry.message.role === "assistant")
		) {
			return;
		}
		if (conversation.toolAssisted && !preferences.allowToolChats) return;

		const response = await target.modelRuntime.completeSimple(model, {
			messages: [
				{
					role: "user",
					content:
						"Extract durable user preferences or facts from this conversation. " +
						"Never store secrets, credentials, one-off tasks, or speculation. " +
						"Return only a JSON string array; return [] when there is nothing durable.\n\n" +
						`<conversation>\n${conversation.text}\n</conversation>`,
					timestamp: Date.now(),
				},
			],
		});
		if (response.stopReason === "error" || response.stopReason === "aborted") return;
		const candidates = parseMemoryCandidates(contentText(response.content));
		if (candidates.length > 0) await memoryStore.merge(candidates, target.sessionId);
	};

	const queueMemoryGeneration = (target: typeof session): void => {
		memoryGenerationTail = memoryGenerationTail.then(() => generateMemories(target)).catch(() => {});
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
			const closeRequest = (reason: RpcExtensionUIRequestClosed["reason"]) => {
				output({ type: "extension_ui_request_closed", id, reason } satisfies RpcExtensionUIRequestClosed);
			};

			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				opts?.signal?.removeEventListener("abort", onAbort);
				pendingExtensionRequests.delete(id);
			};

			const onAbort = () => {
				cleanup();
				resolve(defaultValue);
				closeRequest("aborted");
			};
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			if (opts?.timeout) {
				timeoutId = setTimeout(() => {
					cleanup();
					resolve(defaultValue);
					closeRequest("timeout");
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

	runtimeHost.setRebindSession(async (_replacementSession, options) => {
		await rebindSession(options?.hasWithSession === true);
	});

	const rebindSession = async (notifySessionChanged = false): Promise<void> => {
		session = runtimeHost.session;
		ensureMemorySettings(session);
		unsubscribe?.();
		unsubscribeBackpressure?.();
		unsubscribe = session.subscribe((event) => {
			output(event);
		});
		unsubscribeBackpressure = session.agent.subscribe(async () => {
			await waitForRawStdoutBackpressure();
		});
		if (notifySessionChanged) {
			output({
				type: "session_changed",
				cwd: session.sessionManager.getCwd(),
				sessionId: session.sessionId,
				...(session.sessionFile ? { sessionFile: session.sessionFile } : {}),
				reason: "extension_command",
			} satisfies RpcSessionChangedEventDTO);
		}
		await session.bindExtensions({
			uiContext: createExtensionUIContext(),
			mode: "rpc",
			commandContextActions: {
				waitForIdle: () => session.waitForIdle(),
				newSession: (options) =>
					runtimeHost.newSession({
						...options,
						withSession: ensureWithSessionCallback(options?.withSession),
					}),
				fork: async (entryId, forkOptions) => {
					const result = await runtimeHost.fork(entryId, {
						...forkOptions,
						withSession: ensureWithSessionCallback(forkOptions?.withSession),
					});
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
				switchSession: (sessionPath, options) =>
					runtimeHost.switchSession(sessionPath, {
						...options,
						withSession: ensureWithSessionCallback(options?.withSession),
					}),
				reload: async () => {
					await session.reload();
				},
			},
			shutdownHandler: () => {
				shutdownRequested = true;
			},
			onError: (err) => {
				output({
					type: "extension_error",
					extensionPath: err.extensionPath,
					event: err.event,
					error: err.error,
				} satisfies RpcExtensionErrorEventDTO);
			},
		});

		unsubscribe?.();
		unsubscribeBackpressure?.();
		unsubscribe = session.subscribe((event) => {
			output(event);
			if (event.type === "agent_settled") {
				queueMemoryGeneration(session);
				void checkShutdownRequested();
			}
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
				const previousPrompt = promptPreflightTail;
				let releasePromptPreflight!: () => void;
				promptPreflightTail = new Promise((resolve) => {
					releasePromptPreflight = resolve;
				});
				void (async () => {
					await previousPrompt;
					let preflightSucceeded = false;
					try {
						injectMemoryContext(session);
						await session.prompt(command.message, {
							images: command.images,
							streamingBehavior: command.streamingBehavior,
							source: "rpc",
							preflightResult: (didSucceed) => {
								queueMicrotask(releasePromptPreflight);
								if (didSucceed) {
									preflightSucceeded = true;
									output(success(id, "prompt"));
								}
							},
						});
					} catch (e: unknown) {
						releasePromptPreflight();
						if (!preflightSucceeded) {
							output(error(id, "prompt", e instanceof Error ? e.message : String(e)));
						}
					} finally {
						releasePromptPreflight();
					}
				})();
				return undefined;
			}

			case "steer": {
				if (!session.isStreaming) {
					return error(id, "steer", "Steering is only available while the agent is running");
				}
				await session.steer(command.message, command.images);
				return success(id, "steer");
			}

			case "follow_up": {
				if (!session.isStreaming) {
					return error(id, "follow_up", "Follow-up is only available while the agent is running");
				}
				await session.followUp(command.message, command.images);
				return success(id, "follow_up");
			}

			case "abort": {
				await promptPreflightTail;
				session.clearQueue();
				await session.abort();
				return success(id, "abort");
			}

			case "new_session": {
				const cwd = command.cwd?.trim();
				if (command.cwd !== undefined && !cwd) {
					return error(id, "new_session", "Working directory cannot be empty");
				}
				const options =
					cwd || command.parentSession
						? {
								...(cwd ? { cwd } : {}),
								...(command.parentSession ? { parentSession: command.parentSession } : {}),
							}
						: undefined;
				const result = await runtimeHost.newSession(options);
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
					cwd: session.sessionManager.getCwd(),
					sessionFile: session.sessionFile,
					sessionId: session.sessionId,
					sessionName: session.sessionName,
					autoCompactionEnabled: session.autoCompactionEnabled,
					autoRetryEnabled: session.autoRetryEnabled,
					isRetrying: session.isRetrying,
					retryAttempt: session.retryAttempt,
					messageCount: session.messages.length,
					pendingMessageCount: session.pendingMessageCount,
					projectTrusted: session.settingsManager.isProjectTrusted(),
					projectTrustRequired: hasTrustRequiringProjectResources(session.sessionManager.getCwd()),
				} satisfies RpcSessionState satisfies RpcSessionStateDTO;
				return success(id, "get_state", state);
			}

			case "get_memory_settings": {
				return success(id, "get_memory_settings", getMemorySettingsData());
			}

			case "get_image_generation_settings": {
				return success(
					id,
					"get_image_generation_settings",
					session.settingsManager.getImageGenerationSettings() satisfies RpcImageGenerationSettingsDataDTO,
				);
			}

			case "set_image_generation_settings": {
				if (session.isStreaming) {
					return error(
						id,
						"set_image_generation_settings",
						"Wait for the current response to finish before changing image generation",
					);
				}
				if (session.isCompacting) {
					return error(
						id,
						"set_image_generation_settings",
						"Wait for compaction to finish before changing image generation",
					);
				}
				if (command.enabled !== undefined && typeof command.enabled !== "boolean") {
					return error(id, "set_image_generation_settings", "enabled must be a boolean");
				}
				if (command.provider !== undefined && typeof command.provider !== "string") {
					return error(id, "set_image_generation_settings", "provider must be a string");
				}
				if (command.model !== undefined && typeof command.model !== "string") {
					return error(id, "set_image_generation_settings", "model must be a string");
				}
				if (command.baseUrl !== undefined && typeof command.baseUrl !== "string") {
					return error(id, "set_image_generation_settings", "baseUrl must be a string");
				}

				const provider = command.provider === undefined ? undefined : normalizeProviderId(command.provider);
				if (command.provider !== undefined && (!provider || command.provider.trim().length > 128)) {
					return error(id, "set_image_generation_settings", "A valid provider id is required");
				}
				const model = command.model?.trim();
				if (command.model !== undefined && (!model || model.length > 512)) {
					return error(id, "set_image_generation_settings", "A valid image model id is required");
				}
				let baseUrl: string | undefined;
				if (command.baseUrl !== undefined) {
					const candidate = command.baseUrl.trim();
					if (!candidate || candidate.length > 2048) {
						return error(id, "set_image_generation_settings", "A valid image generation base URL is required");
					}
					let parsed: URL;
					try {
						parsed = new URL(candidate);
					} catch {
						return error(id, "set_image_generation_settings", "Image generation base URL is not valid");
					}
					if (
						(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
						parsed.username ||
						parsed.password
					) {
						return error(
							id,
							"set_image_generation_settings",
							"Image generation base URL must use HTTP or HTTPS without embedded credentials",
						);
					}
					baseUrl = parsed.toString().replace(/\/$/, "");
				}

				session.settingsManager.setImageGenerationSettings({
					enabled: command.enabled,
					provider,
					model,
					baseUrl,
				});
				await session.reload();
				return success(
					id,
					"set_image_generation_settings",
					session.settingsManager.getImageGenerationSettings() satisfies RpcImageGenerationSettingsDataDTO,
				);
			}

			case "set_memory_settings": {
				if (command.enabled !== undefined && typeof command.enabled !== "boolean") {
					return error(id, "set_memory_settings", "enabled must be a boolean");
				}
				if (command.allowToolChats !== undefined && typeof command.allowToolChats !== "boolean") {
					return error(id, "set_memory_settings", "allowToolChats must be a boolean");
				}
				if (command.useMemories !== undefined && typeof command.useMemories !== "boolean") {
					return error(id, "set_memory_settings", "useMemories must be a boolean");
				}
				if (command.generateMemories !== undefined && typeof command.generateMemories !== "boolean") {
					return error(id, "set_memory_settings", "generateMemories must be a boolean");
				}

				const currentTaskSettings = ensureMemorySettings();
				if (
					command.useMemories !== undefined &&
					command.useMemories !== currentTaskSettings.useMemories &&
					hasSessionUserMessage(session)
				) {
					return error(id, "set_memory_settings", "Use memories cannot change after the conversation starts");
				}

				if (command.enabled !== undefined || command.allowToolChats !== undefined) {
					session.settingsManager.setMemorySettings({
						enabled: command.enabled,
						allowToolChats: command.allowToolChats,
					});
				}
				setSessionMemorySettings(session.sessionManager, {
					useMemories: command.useMemories ?? currentTaskSettings.useMemories,
					generateMemories: command.generateMemories ?? currentTaskSettings.generateMemories,
				});
				return success(id, "set_memory_settings", getMemorySettingsData());
			}

			case "reset_memories": {
				if (session.isStreaming) {
					return error(id, "reset_memories", "Wait for the current response to finish before resetting memories");
				}
				await memoryGenerationTail;
				await memoryStore.reset();
				return success(id, "reset_memories", {
					count: 0,
					path: memoryStore.filePath,
				} satisfies RpcResetMemoriesDataDTO);
			}

			// =================================================================
			// Model
			// =================================================================

			case "set_model": {
				const models = await session.modelRuntime.getAvailable();
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
				const models = [...(await session.modelRuntime.getAvailable())];
				return success(id, "get_available_models", { models } satisfies RpcGetAvailableModelsDataDTO);
			}

			case "get_auth_status": {
				const providers =
					command.providers && command.providers.length > 0
						? command.providers
						: [
								...new Set([
									...session.modelRuntime.getModels().map((model) => model.provider),
									...(await session.modelRuntime.getCredentialStore().list()).map((entry) => entry.providerId),
								]),
							];
				const statuses = Object.fromEntries(
					providers.map((provider) => [provider, session.modelRuntime.getProviderAuthStatus(provider)]),
				);
				return success(id, "get_auth_status", { providers: statuses } satisfies RpcGetAuthStatusDataDTO);
			}

			case "set_api_key": {
				const provider = normalizeProviderId(command.provider);
				const apiKey = command.apiKey.trim();
				if (!provider) {
					return error(id, "set_api_key", "Provider is required");
				}
				if (!apiKey) {
					return error(id, "set_api_key", "API key is required");
				}
				await session.modelRuntime
					.getCredentialStore()
					.modify(provider, async () => ({ type: "api_key", key: apiKey }));
				await session.modelRuntime.refresh();
				return success(id, "set_api_key", {
					provider,
					status: session.modelRuntime.getProviderAuthStatus(provider),
				});
			}

			case "remove_api_key": {
				const provider = normalizeProviderId(command.provider);
				if (!provider) {
					return error(id, "remove_api_key", "Provider is required");
				}
				await session.modelRuntime.getCredentialStore().delete(provider);
				await session.modelRuntime.refresh();
				return success(id, "remove_api_key", {
					provider,
					status: session.modelRuntime.getProviderAuthStatus(provider),
				});
			}

			case "get_custom_models": {
				const config = readCustomModelsConfig();
				const credentialsByProvider = new Map(
					await Promise.all(
						Object.keys(config.providers).map(
							async (provider) =>
								[provider, await session.modelRuntime.getCredentialStore().read(provider)] as const,
						),
					),
				);
				return success(id, "get_custom_models", {
					path: getModelsPath(),
					providers: sanitizeCustomModelsConfig(config, (provider) => {
						const providerConfig = config.providers[provider];
						const credential = credentialsByProvider.get(provider);
						const credentialEnv = credential?.type === "api_key" ? credential.env : undefined;
						const env =
							providerConfig?.env || credentialEnv ? { ...providerConfig?.env, ...credentialEnv } : undefined;
						const proxyUrl = getProxyUrlFromEnv(env);
						return {
							authKind: credential?.type === "api_key" ? "api_key" : "none",
							hasStoredAuth: credential?.type === "api_key",
							...(proxyUrl ? { proxyUrl } : {}),
						};
					}).providers,
				} satisfies RpcGetCustomModelsDataDTO);
			}

			case "replace_custom_models": {
				const previousProviders = Object.keys(readCustomModelsConfig().providers);
				const config = validateImportedCustomModels(command.providers);
				writeCustomModelsConfig(config);
				await session.modelRuntime.refresh();
				const models = Object.values(config.providers).reduce(
					(count, provider) => count + (provider.models?.length || 0),
					0,
				);
				const removedStoredAuthProviders: string[] = [];
				if (command.removeOrphanStoredAuth) {
					for (const provider of previousProviders) {
						if (provider in config.providers) continue;
						if ((await session.modelRuntime.getCredentialStore().read(provider)) === undefined) continue;
						await session.modelRuntime.getCredentialStore().delete(provider);
						removedStoredAuthProviders.push(provider);
					}
				}
				return success(id, "replace_custom_models", {
					path: getModelsPath(),
					providers: Object.keys(config.providers).length,
					models,
					removedStoredAuthProviders,
				});
			}

			case "fetch_provider_models": {
				const provider = normalizeProviderId(command.provider);
				if (!provider) {
					return error(id, "fetch_provider_models", "Provider is required");
				}
				const preservedProvider = command.preserveHeadersFromProvider
					? readCustomModelsConfig().providers[normalizeProviderId(command.preserveHeadersFromProvider)]
					: undefined;
				const headers = mergeRedactedHeaders(command.headers, preservedProvider?.headers);
				let apiKey = command.apiKey?.trim() || undefined;
				let env = mergeProxyEnv(preservedProvider?.env, command.proxyUrl);
				let storedHeaders: Record<string, string> | undefined;
				if (!apiKey && command.useStoredAuthProvider) {
					const model: Model<"openai-completions" | "anthropic-messages"> = {
						id: "__model_list__",
						name: "__model_list__",
						api: command.api,
						provider,
						baseUrl: command.baseUrl.trim().replace(/\/+$/, ""),
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 4096,
						maxTokens: 8,
					};
					const storedAuth = await session.modelRuntime.getAuth(model).catch(() => undefined);
					if (storedAuth) {
						apiKey = storedAuth.auth.apiKey;
						env = { ...storedAuth.env, ...env };
						storedHeaders = definedHeaders(storedAuth.auth.headers);
					}
				}
				return success(
					id,
					"fetch_provider_models",
					await fetchRemoteProviderModels({
						baseUrl: command.baseUrl,
						api: command.api,
						apiKey,
						headers: storedHeaders || headers ? { ...storedHeaders, ...headers } : undefined,
						env,
					}),
				);
			}

			case "test_model": {
				const provider = normalizeProviderId(command.provider);
				const model = session.modelRuntime.getModel(provider, command.modelId.trim());
				if (!model) {
					return success(id, "test_model", {
						ok: false,
						latencyMs: 0,
						category: "model" as const,
						message: `Model not found: ${provider}/${command.modelId.trim()}`,
					});
				}
				let authError: string | undefined;
				const auth = await session.modelRuntime.getAuth(model).catch((error) => {
					authError = error instanceof Error ? error.message : String(error);
					return undefined;
				});
				if (!auth?.auth.apiKey) {
					return success(id, "test_model", {
						ok: false,
						latencyMs: 0,
						category: "auth" as const,
						message: authError ?? `No API key found for "${provider}"`,
					});
				}
				return success(
					id,
					"test_model",
					await testModelConnection(model, {
						apiKey: auth.auth.apiKey,
						headers: definedHeaders(auth.auth.headers),
						env: auth.env,
					}),
				);
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
				let env = mergeProxyEnv(preservedProvider?.env, command.proxyUrl);
				let storedHeaders: Record<string, string> | undefined;
				if (!apiKey && command.useStoredAuthProvider) {
					const storedAuth = await session.modelRuntime.getAuth(model).catch(() => undefined);
					if (storedAuth) {
						apiKey = storedAuth.auth.apiKey;
						env = { ...storedAuth.env, ...env };
						storedHeaders = definedHeaders(storedAuth.auth.headers);
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
				const { env: oldEnv, headers: _oldHeaders, ...providerConfigWithoutHeaders } = providerConfig;
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
				const env = mergeProxyEnv(oldEnv, command.proxyUrl);
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
					...(env && Object.keys(env).length > 0 ? { env } : {}),
					api: command.api,
					models: [
						...existingModels.filter((item) => item.id !== modelId && item.id !== command.replaceModelId?.trim()),
						model,
					],
				};
				writeCustomModelsConfig(config);
				if (command.authKind === "none") {
					await session.modelRuntime.getCredentialStore().delete(provider);
				} else {
					const existingCredential = await session.modelRuntime.getCredentialStore().read(provider);
					const existingCredentialEnv =
						existingCredential?.type === "api_key" ? mergeProxyEnv(existingCredential.env, "") : undefined;
					if (command.apiKey?.trim()) {
						await session.modelRuntime.getCredentialStore().modify(provider, async () => ({
							type: "api_key",
							key: command.apiKey?.trim() ?? "",
							...(existingCredentialEnv ? { env: existingCredentialEnv } : {}),
						}));
					} else if (
						command.proxyUrl !== undefined &&
						existingCredential?.type === "api_key" &&
						existingCredential.env
					) {
						await session.modelRuntime.getCredentialStore().modify(provider, async () => ({
							type: "api_key",
							key: existingCredential.key,
							...(existingCredentialEnv ? { env: existingCredentialEnv } : {}),
						}));
					}
				}
				await session.modelRuntime.refresh();
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
							await session.modelRuntime.getCredentialStore().delete(provider);
						}
					}
					writeCustomModelsConfig(config);
					await session.modelRuntime.refresh();
				}
				return success(id, "remove_custom_model", { path: getModelsPath(), provider, modelId });
			}

			case "remove_custom_provider": {
				const provider = normalizeProviderId(command.provider);
				if (!provider) {
					return error(id, "remove_custom_provider", "Provider is required");
				}
				const config = readCustomModelsConfig();
				delete config.providers[provider];
				writeCustomModelsConfig(config);
				if (command.removeAuth !== false) {
					await session.modelRuntime.getCredentialStore().delete(provider);
				}
				await session.modelRuntime.refresh();
				return success(id, "remove_custom_provider", { path: getModelsPath(), provider });
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

			case "get_available_thinking_levels": {
				const levels = session.getAvailableThinkingLevels();
				return success(id, "get_available_thinking_levels", { levels });
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
					id,
				});
				return success(id, "bash", result);
			}

			case "abort_bash": {
				session.abortBash(command.executionId);
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
				const cwd = command.cwd?.trim();
				if (command.cwd !== undefined && !cwd) {
					return error(id, "get_sessions", "Working directory cannot be empty");
				}
				let sessions: SessionInfo[];
				if (cwd) {
					const sessionDir = session.sessionManager.usesDefaultSessionDir()
						? undefined
						: session.sessionManager.getSessionDir();
					sessions = await SessionManager.list(cwd, sessionDir);
				} else {
					sessions = command.all
						? session.sessionManager.usesDefaultSessionDir()
							? await SessionManager.listAll()
							: await SessionManager.listAll(session.sessionManager.getSessionDir())
						: await SessionManager.list(session.sessionManager.getCwd(), session.sessionManager.getSessionDir());
				}
				const { sessions: pageSessions, ...metadata } = getSessionPage(sessions, command);
				const wireMetadata = metadata satisfies Omit<RpcGetSessionsDataDTO, "sessions">;
				// Not `satisfies RpcGetSessionsDataDTO`: SessionInfo.created/modified are Date
				// instances here that serialize to ISO strings on the wire, so the in-memory
				// object intentionally doesn't match the (post-serialization) DTO.
				return success(id, "get_sessions", {
					sessions: pageSessions,
					...wireMetadata,
				});
			}

			case "switch_session": {
				const result = await runtimeHost.switchSession(command.sessionPath);
				return success(id, "switch_session", result);
			}

			case "fork": {
				await promptPreflightTail;
				if (session.isStreaming || session.isCompacting) {
					return error(id, "fork", "Cannot fork while the agent is running or compacting");
				}
				const result = await runtimeHost.fork(command.entryId);
				if (result.cancelled) {
					return success(id, "fork", { cancelled: true } satisfies RpcForkResultDTO);
				}
				return success(id, "fork", {
					text: result.selectedText ?? "",
					cancelled: false,
				} satisfies RpcForkResultDTO);
			}

			case "clone": {
				await promptPreflightTail;
				if (session.isStreaming || session.isCompacting) {
					return error(id, "clone", "Cannot clone while the agent is running or compacting");
				}
				const leafId = session.sessionManager.getLeafId();
				if (!leafId) {
					return error(id, "clone", "Cannot clone session: no current entry selected");
				}
				const result = await runtimeHost.fork(leafId, { position: "at" });
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
				return success(id, "get_tree", {
					tree: sessionManager.getTree().map(toRpcSessionTreeNode),
					leafId: sessionManager.getLeafId(),
				});
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

			case "get_resources": {
				const resources = await loadResourceCatalog(
					() => {
						const packageManager = new DefaultPackageManager({
							cwd: session.sessionManager.getCwd(),
							agentDir: getAgentDir(),
							settingsManager: session.settingsManager,
						});
						const extensionsResult = session.resourceLoader.getExtensions();
						const skillsResult = session.resourceLoader.getSkills();
						const promptsResult = session.resourceLoader.getPrompts();
						return {
							packages: packageManager.listConfiguredPackages(),
							extensions: extensionsResult.extensions,
							extensionErrors: extensionsResult.errors.map((diagnostic) => ({
								extensionPath: diagnostic.path,
								error: diagnostic.error,
							})),
							extensionDiagnostics: [
								...session.extensionRunner.getCommandDiagnostics(),
								...session.extensionRunner.getShortcutDiagnostics(),
							],
							skills: skillsResult.skills,
							skillDiagnostics: skillsResult.diagnostics,
							prompts: promptsResult.prompts,
							promptDiagnostics: promptsResult.diagnostics,
							extensionFlags: Array.from(session.extensionRunner.getFlags().values()).map((flag) => ({
								name: flag.name,
								type: flag.type,
								description: flag.description,
								default: flag.default,
								extensionPath: flag.extensionPath,
							})),
						};
					},
					command.reload
						? async () => {
								if (session.isStreaming) {
									throw new Error("Wait for the current response to finish before reloading resources");
								}
								if (session.isCompacting) {
									throw new Error("Wait for compaction to finish before reloading resources");
								}
								await session.reload();
							}
						: undefined,
				);
				return success(id, "get_resources", resources);
			}

			case "manage_package": {
				if (session.isStreaming) {
					return error(id, "manage_package", "Wait for the current response to finish before changing packages");
				}
				if (session.isCompacting) {
					return error(id, "manage_package", "Wait for compaction to finish before changing packages");
				}
				const source = typeof command.source === "string" ? command.source.trim() : "";
				if (!source || source.length > 2048 || source.includes("\0")) {
					return error(id, "manage_package", "A valid package source is required");
				}
				if (command.action !== "install" && command.action !== "remove") {
					return error(id, "manage_package", "Package action must be install or remove");
				}
				if (command.local !== undefined && typeof command.local !== "boolean") {
					return error(id, "manage_package", "Package scope must be user or project");
				}

				const packageManager = new DefaultPackageManager({
					cwd: session.sessionManager.getCwd(),
					agentDir: getAgentDir(),
					settingsManager: session.settingsManager,
				});
				if (command.action === "install") {
					await packageManager.installAndPersist(source, { local: command.local === true });
					await session.reload();
					return success(id, "manage_package", {});
				}

				const removed = await packageManager.removeAndPersist(source, { local: command.local === true });
				if (!removed) {
					return error(id, "manage_package", `No matching package found for ${source}`);
				}
				await session.reload();
				return success(id, "manage_package", { removed: true });
			}

			case "set_project_trust": {
				const cwd = session.sessionManager.getCwd();
				if (session.isStreaming) {
					return error(id, "set_project_trust", "Wait for the current response to finish before changing trust");
				}
				if (session.isCompacting) {
					return error(id, "set_project_trust", "Wait for compaction to finish before changing trust");
				}
				new ProjectTrustStore(getAgentDir()).set(cwd, command.trusted);
				session.settingsManager.setProjectTrusted(command.trusted);
				// Reload so newly-trusted project extensions/settings load (or
				// untrusted ones unload) and rebind to the running session.
				await session.reload();
				return success(id, "set_project_trust", {
					trusted: session.settingsManager.isProjectTrusted(),
					projectTrustRequired: hasTrustRequiringProjectResources(cwd),
				});
			}

			case "get_project_trust_entries": {
				const store = new ProjectTrustStore(getAgentDir());
				const cwd = session.sessionManager.getCwd();
				return success(id, "get_project_trust_entries", {
					entries: store.list(),
					currentPath: cwd,
					currentEntryPath: store.getEntry(cwd)?.path ?? null,
					currentTrusted: session.settingsManager.isProjectTrusted(),
				});
			}

			case "set_project_trust_entry": {
				if (session.isStreaming) {
					return error(
						id,
						"set_project_trust_entry",
						"Wait for the current response to finish before changing trust",
					);
				}
				if (session.isCompacting) {
					return error(id, "set_project_trust_entry", "Wait for compaction to finish before changing trust");
				}
				const path = typeof command.path === "string" ? command.path.trim() : "";
				if (!path) {
					return error(id, "set_project_trust_entry", "A folder path is required");
				}
				if (command.decision !== true && command.decision !== false && command.decision !== null) {
					return error(id, "set_project_trust_entry", "Decision must be true, false, or null");
				}
				const store = new ProjectTrustStore(getAgentDir());
				store.set(path, command.decision);
				// The edited entry may cover the current workspace (it, or an
				// ancestor). Recompute effective trust with the same rule the
				// desktop backend boots with, and hot-reload on a change.
				const cwd = session.sessionManager.getCwd();
				const effective = !hasTrustRequiringProjectResources(cwd) || store.get(cwd) === true;
				let reloaded = false;
				if (effective !== session.settingsManager.isProjectTrusted()) {
					session.settingsManager.setProjectTrusted(effective);
					await session.reload();
					reloaded = true;
				}
				return success(id, "set_project_trust_entry", {
					entries: store.list(),
					currentEntryPath: store.getEntry(cwd)?.path ?? null,
					trusted: session.settingsManager.isProjectTrusted(),
					reloaded,
				});
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
