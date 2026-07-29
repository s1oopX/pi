import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import {
	type OAuthClientProvider,
	type OAuthDiscoveryState,
	UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
	OAuthClientInformationFullSchema,
	type OAuthClientInformationMixed,
	OAuthClientInformationSchema,
	type OAuthClientMetadata,
	type OAuthTokens,
	OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { CallToolResult, CompatibilityCallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { Type } from "typebox";
import { VERSION } from "../config.ts";
import { openBrowser } from "../utils/open-browser.ts";
import { FileAuthStorageBackend } from "./auth-storage.ts";
import { getCodexPluginDataDir } from "./codex-plugin-hooks.ts";
import type { AgentToolResult, ExtensionAPI, ExtensionContext, ExtensionFactory } from "./extensions/types.ts";

const CONNECT_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 60_000;
const OAUTH_TIMEOUT_MS = 5 * 60_000;
const MAX_MCP_TOOLS = 500;

type BrowserOpener = (target: string) => void | Promise<void>;

interface CodexMcpServerConfig {
	name: string;
	url: string;
	headers?: Record<string, string>;
	oauthResource?: string;
	note?: string;
}

interface PersistedMcpOAuthState {
	clientInformation?: OAuthClientInformationMixed;
	tokens?: OAuthTokens;
	codeVerifier?: string;
	discoveryState?: OAuthDiscoveryState;
	redirectUrl?: string;
}

interface McpToolDetails {
	server: string;
	tool: string;
	structuredContent?: Record<string, unknown>;
}

interface McpConnectionAttempt {
	client: Client;
	transport: StreamableHTTPClientTransport;
}

interface OAuthCallbackServer {
	redirectUrl: string;
	code: Promise<string>;
	close(): void;
}

export interface CodexPluginMcpFactoryOptions {
	configPath: string;
	pluginRoot: string;
	agentDir: string;
	openBrowser?: BrowserOpener;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shortHash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function safeNameSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || shortHash(value);
}

function fitToolName(value: string): string {
	return value.length <= 64 ? value : `${value.slice(0, 55)}_${shortHash(value)}`;
}

function mcpToolName(serverName: string, toolName: string): string {
	return fitToolName(`mcp__${safeNameSegment(serverName)}__${safeNameSegment(toolName)}`);
}

function parseHeaders(value: unknown, configPath: string, serverName: string): Record<string, string> | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) throw new Error(`Invalid headers for MCP server "${serverName}" in ${configPath}`);
	const headers: Record<string, string> = {};
	for (const [name, headerValue] of Object.entries(value)) {
		if (!name.trim() || typeof headerValue !== "string") {
			throw new Error(`Invalid header for MCP server "${serverName}" in ${configPath}`);
		}
		headers[name] = headerValue;
	}
	return Object.keys(headers).length > 0 ? headers : undefined;
}

function validateServerUrl(value: string, configPath: string, serverName: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`Invalid URL for MCP server "${serverName}" in ${configPath}`);
	}
	if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) {
		throw new Error(`MCP server "${serverName}" must use an HTTP(S) URL without embedded credentials`);
	}
	return url;
}

function readCodexMcpServers(configPath: string): CodexMcpServerConfig[] {
	const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
	if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
		throw new Error(`Invalid Codex MCP config: ${configPath}`);
	}

	const servers: CodexMcpServerConfig[] = [];
	for (const [rawName, value] of Object.entries(parsed.mcpServers)) {
		const name = rawName.trim();
		if (!name || !isRecord(value)) {
			throw new Error(`Invalid MCP server entry in ${configPath}`);
		}
		const type = typeof value.type === "string" ? value.type.trim().toLowerCase() : undefined;
		if (type && type !== "http") {
			console.warn(`Skipping unsupported Codex MCP server "${name}" (${type}); only HTTP servers are supported`);
			continue;
		}
		if (typeof value.url !== "string" || !value.url.trim()) {
			console.warn(`Skipping unsupported Codex MCP server "${name}" without an HTTP URL`);
			continue;
		}
		const url = validateServerUrl(value.url.trim(), configPath, name);
		let oauthResource: string | undefined;
		if (typeof value.oauth_resource === "string" && value.oauth_resource.trim()) {
			const resource = validateServerUrl(value.oauth_resource.trim(), configPath, name);
			if (resource.origin !== url.origin) {
				throw new Error(`OAuth resource for MCP server "${name}" must match the server origin`);
			}
			oauthResource = resource.toString();
		}
		servers.push({
			name,
			url: url.toString(),
			headers: parseHeaders(value.headers, configPath, name),
			oauthResource,
			note: typeof value.note === "string" ? value.note.trim() || undefined : undefined,
		});
	}

	if (servers.length === 0) {
		throw new Error(`Codex MCP config has no supported HTTP servers: ${configPath}`);
	}
	return servers;
}

function parseLoopbackRedirectUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" || !new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname)) {
			return undefined;
		}
		return url.toString();
	} catch {
		return undefined;
	}
}

function parseOAuthState(content: string | undefined): PersistedMcpOAuthState {
	if (!content) return {};
	try {
		const parsed = JSON.parse(content) as unknown;
		if (!isRecord(parsed)) return {};
		const fullClient = OAuthClientInformationFullSchema.safeParse(parsed.clientInformation);
		const basicClient = fullClient.success
			? undefined
			: OAuthClientInformationSchema.safeParse(parsed.clientInformation);
		const tokens = OAuthTokensSchema.safeParse(parsed.tokens);
		const discoveryState =
			isRecord(parsed.discoveryState) && typeof parsed.discoveryState.authorizationServerUrl === "string"
				? (parsed.discoveryState as unknown as OAuthDiscoveryState)
				: undefined;
		return {
			clientInformation: fullClient.success ? fullClient.data : basicClient?.success ? basicClient.data : undefined,
			tokens: tokens.success ? tokens.data : undefined,
			codeVerifier: typeof parsed.codeVerifier === "string" ? parsed.codeVerifier : undefined,
			discoveryState,
			redirectUrl: parseLoopbackRedirectUrl(parsed.redirectUrl),
		};
	} catch {
		return {};
	}
}

function readOAuthState(storage: FileAuthStorageBackend): PersistedMcpOAuthState {
	return storage.withLock((content) => ({ result: parseOAuthState(content) }));
}

function updateOAuthState(
	storage: FileAuthStorageBackend,
	update: (current: PersistedMcpOAuthState) => PersistedMcpOAuthState,
): void {
	storage.withLock((content) => ({
		result: undefined,
		next: JSON.stringify(update(parseOAuthState(content)), null, 2),
	}));
}

function sendHtml(response: ServerResponse, statusCode: number, heading: string, message: string): void {
	const escapeHtml = (value: string): string =>
		value
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&#39;");
	response.statusCode = statusCode;
	response.setHeader("content-type", "text/html; charset=utf-8");
	response.setHeader("cache-control", "no-store");
	response.end(
		`<!doctype html><meta charset="utf-8"><title>${escapeHtml(heading)}</title><main style="font:16px system-ui;max-width:640px;margin:15vh auto;padding:24px"><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p></main>`,
	);
}

async function startOAuthCallbackServer(expectedState: string, signal?: AbortSignal): Promise<OAuthCallbackServer> {
	if (signal?.aborted) throw new Error("MCP authorization cancelled");
	const host = "127.0.0.1";
	const callbackPath = `/oauth/callback/${randomUUID()}`;
	let resolveCode: (code: string) => void = () => {};
	let rejectCode: (error: Error) => void = () => {};
	const code = new Promise<string>((resolve, reject) => {
		resolveCode = resolve;
		rejectCode = reject;
	});
	void code.catch(() => {});

	let server: Server;
	let settled = false;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	const finish = (result: { code: string } | { error: Error }): void => {
		if (settled) return;
		settled = true;
		if (timeout) clearTimeout(timeout);
		if (onAbort) signal?.removeEventListener("abort", onAbort);
		server.close();
		if ("code" in result) resolveCode(result.code);
		else rejectCode(result.error);
	};

	server = createServer((request, response) => {
		const requestUrl = new URL(request.url ?? "/", `http://${host}`);
		if (request.method !== "GET" || requestUrl.pathname !== callbackPath) {
			sendHtml(response, 404, "Authorization callback not found", "Return to Pi Studio and try again.");
			return;
		}
		const oauthError = requestUrl.searchParams.get("error");
		if (oauthError) {
			const description = requestUrl.searchParams.get("error_description") ?? oauthError;
			sendHtml(response, 400, "Authorization failed", description);
			finish({ error: new Error(`MCP authorization failed: ${description}`) });
			return;
		}
		if (requestUrl.searchParams.get("state") !== expectedState) {
			sendHtml(response, 400, "Authorization failed", "OAuth state did not match.");
			finish({ error: new Error("MCP OAuth state mismatch") });
			return;
		}
		const authorizationCode = requestUrl.searchParams.get("code");
		if (!authorizationCode) {
			sendHtml(response, 400, "Authorization failed", "No authorization code was returned.");
			finish({ error: new Error("MCP authorization returned no code") });
			return;
		}
		sendHtml(response, 200, "Authorization successful", "You may close this page and return to Pi Studio.");
		finish({ code: authorizationCode });
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, host, () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
	server.on("error", (error) => finish({ error }));
	onAbort = () => finish({ error: new Error("MCP authorization cancelled") });
	signal?.addEventListener("abort", onAbort, { once: true });
	timeout = setTimeout(() => finish({ error: new Error("MCP authorization timed out") }), OAUTH_TIMEOUT_MS);

	const address = server.address();
	if (!address || typeof address === "string") {
		finish({ error: new Error("Could not determine the MCP OAuth callback port") });
		throw new Error("Could not determine the MCP OAuth callback port");
	}
	return {
		redirectUrl: `http://${host}:${address.port}${callbackPath}`,
		code,
		close: () => finish({ error: new Error("MCP authorization cancelled") }),
	};
}

class PersistentMcpOAuthProvider implements OAuthClientProvider {
	private storage: FileAuthStorageBackend;
	private currentRedirectUrl: string;
	private serverUrl: string;
	private oauthResource: string | undefined;
	private openAuthorization: (url: URL) => void | Promise<void>;
	private oauthState: string;
	authorizationStarted = false;
	needsClientReregistration = false;

	constructor(options: {
		storage: FileAuthStorageBackend;
		redirectUrl: string;
		serverUrl: string;
		oauthResource?: string;
		oauthState: string;
		openAuthorization: (url: URL) => void | Promise<void>;
	}) {
		this.storage = options.storage;
		this.currentRedirectUrl = options.redirectUrl;
		this.serverUrl = options.serverUrl;
		this.oauthResource = options.oauthResource;
		this.oauthState = options.oauthState;
		this.openAuthorization = options.openAuthorization;
	}

	get redirectUrl(): URL {
		return new URL(this.currentRedirectUrl);
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: "Pi Studio MCP",
			redirect_uris: [this.currentRedirectUrl],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		};
	}

	state(): string {
		return this.oauthState;
	}

	clientInformation(): OAuthClientInformationMixed | undefined {
		return readOAuthState(this.storage).clientInformation;
	}

	saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
		updateOAuthState(this.storage, (current) => ({
			...current,
			clientInformation,
			redirectUrl: this.currentRedirectUrl,
		}));
	}

	tokens(): OAuthTokens | undefined {
		return readOAuthState(this.storage).tokens;
	}

	saveTokens(tokens: OAuthTokens): void {
		updateOAuthState(this.storage, (current) => ({
			...current,
			tokens,
			redirectUrl: this.currentRedirectUrl,
		}));
	}

	async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
		const state = readOAuthState(this.storage);
		if (state.clientInformation && state.redirectUrl !== this.currentRedirectUrl) {
			this.needsClientReregistration = true;
			return;
		}
		this.authorizationStarted = true;
		await this.openAuthorization(authorizationUrl);
	}

	saveCodeVerifier(codeVerifier: string): void {
		updateOAuthState(this.storage, (current) => ({ ...current, codeVerifier }));
	}

	codeVerifier(): string {
		const verifier = readOAuthState(this.storage).codeVerifier;
		if (!verifier) throw new Error("No MCP OAuth code verifier is saved");
		return verifier;
	}

	invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
		updateOAuthState(this.storage, (current) => ({
			...current,
			clientInformation: scope === "all" || scope === "client" ? undefined : current.clientInformation,
			tokens: scope === "all" || scope === "tokens" ? undefined : current.tokens,
			codeVerifier: scope === "all" || scope === "verifier" ? undefined : current.codeVerifier,
			discoveryState: scope === "all" || scope === "discovery" ? undefined : current.discoveryState,
			redirectUrl: scope === "all" ? undefined : current.redirectUrl,
		}));
	}

	saveDiscoveryState(discoveryState: OAuthDiscoveryState): void {
		updateOAuthState(this.storage, (current) => ({ ...current, discoveryState }));
	}

	discoveryState(): OAuthDiscoveryState | undefined {
		return readOAuthState(this.storage).discoveryState;
	}

	async validateResourceURL(serverUrl: string | URL, resource?: string): Promise<URL | undefined> {
		const server = new URL(serverUrl);
		const candidate = this.oauthResource ? new URL(this.oauthResource) : resource ? new URL(resource) : undefined;
		if (!candidate) return undefined;
		if (server.origin !== new URL(this.serverUrl).origin || candidate.origin !== server.origin) {
			throw new Error("MCP OAuth resource does not match the MCP server origin");
		}
		return candidate;
	}

	clearForClientReregistration(): void {
		this.needsClientReregistration = false;
		this.authorizationStarted = false;
		updateOAuthState(this.storage, (current) => ({
			...current,
			clientInformation: undefined,
			tokens: undefined,
			codeVerifier: undefined,
			redirectUrl: undefined,
		}));
	}
}

function stringifyUnknown(value: unknown): string {
	return JSON.stringify(value, null, 2) ?? String(value);
}

function mcpErrorMessage(result: CallToolResult): string {
	const text = result.content
		.filter(
			(content): content is Extract<(typeof result.content)[number], { type: "text" }> => content.type === "text",
		)
		.map((content) => content.text)
		.join("\n")
		.trim();
	return text || stringifyUnknown(result.content);
}

function convertMcpResult(
	result: CallToolResult | CompatibilityCallToolResult,
	server: string,
	tool: string,
): AgentToolResult<McpToolDetails> {
	if ("toolResult" in result) {
		return {
			content: [{ type: "text", text: stringifyUnknown(result.toolResult) }],
			details: { server, tool },
		};
	}
	if (result.isError) throw new Error(mcpErrorMessage(result));

	const content: AgentToolResult<McpToolDetails>["content"] = [];
	for (const item of result.content) {
		if (item.type === "text") {
			content.push({ type: "text", text: item.text });
		} else if (item.type === "image") {
			content.push({ type: "image", data: item.data, mimeType: item.mimeType });
		} else {
			content.push({ type: "text", text: stringifyUnknown(item) });
		}
	}
	if (result.structuredContent) {
		content.push({ type: "text", text: `MCP structured content:\n${stringifyUnknown(result.structuredContent)}` });
	}
	if (content.length === 0) {
		content.push({ type: "text", text: "MCP tool completed without content." });
	}
	return {
		content,
		details: { server, tool, structuredContent: result.structuredContent },
	};
}

class CodexMcpConnection {
	private config: CodexMcpServerConfig;
	private pi: ExtensionAPI;
	private storage: FileAuthStorageBackend;
	private browserOpener: BrowserOpener;
	private client: Client | undefined;
	private connectPromise: Promise<string[]> | undefined;
	private registeredToolNames = new Map<string, string>();
	private connectToolName: string;

	constructor(options: {
		config: CodexMcpServerConfig;
		pi: ExtensionAPI;
		statePath: string;
		browserOpener: BrowserOpener;
	}) {
		this.config = options.config;
		this.pi = options.pi;
		this.storage = new FileAuthStorageBackend(options.statePath);
		this.browserOpener = options.browserOpener;
		this.connectToolName = mcpToolName(this.config.name, "connect");
	}

	registerConnectTool(): void {
		this.pi.registerTool({
			name: this.connectToolName,
			label: `Connect ${this.config.name} MCP`,
			description: [
				`Connect to the ${this.config.name} MCP server and load its tools.`,
				this.config.note,
				"May open a browser for OAuth authorization.",
			]
				.filter((value): value is string => Boolean(value))
				.join(" "),
			promptSnippet: `Connect to the ${this.config.name} MCP server when its tools are needed`,
			parameters: Type.Object({}),
			executionMode: "sequential",
			execute: async (_toolCallId, _params, signal, _onUpdate, ctx) => {
				const addedToolNames = await this.connectInteractive(ctx, signal);
				return {
					content: [
						{
							type: "text",
							text: addedToolNames.length
								? `Connected to ${this.config.name} MCP and loaded ${addedToolNames.length} tool(s).`
								: `Already connected to ${this.config.name} MCP.`,
						},
					],
					details: { server: this.config.name, tools: [...this.registeredToolNames.values()] },
					addedToolNames,
				};
			},
		});
	}

	async autoConnect(): Promise<void> {
		const state = readOAuthState(this.storage);
		if (!state.tokens || !state.redirectUrl) return;
		const provider = this.createOAuthProvider(state.redirectUrl, randomBytes(32).toString("hex"), () => {});
		const attempt = this.createAttempt(provider);
		const error = await this.tryConnect(attempt);
		if (error) {
			await attempt.client.close().catch(() => {});
			return;
		}
		this.client = attempt.client;
		try {
			await this.registerRemoteTools();
		} catch {
			await this.close();
		}
	}

	async close(): Promise<void> {
		const client = this.client;
		this.client = undefined;
		if (client) await client.close().catch(() => {});
	}

	private createOAuthProvider(
		redirectUrl: string,
		oauthState: string,
		openAuthorization: (url: URL) => void | Promise<void>,
	): PersistentMcpOAuthProvider {
		return new PersistentMcpOAuthProvider({
			storage: this.storage,
			redirectUrl,
			serverUrl: this.config.url,
			oauthResource: this.config.oauthResource,
			oauthState,
			openAuthorization,
		});
	}

	private createAttempt(provider: OAuthClientProvider): McpConnectionAttempt {
		const client = new Client({ name: "pi-studio", version: VERSION }, { capabilities: {} });
		const transport = new StreamableHTTPClientTransport(new URL(this.config.url), {
			authProvider: provider,
			requestInit: this.config.headers ? { headers: this.config.headers } : undefined,
		});
		return { client, transport };
	}

	private async tryConnect(attempt: McpConnectionAttempt, signal?: AbortSignal): Promise<unknown | undefined> {
		try {
			await attempt.client.connect(attempt.transport, { signal, timeout: CONNECT_TIMEOUT_MS });
			return undefined;
		} catch (error) {
			return error;
		}
	}

	private async connectInteractive(ctx: ExtensionContext, signal?: AbortSignal): Promise<string[]> {
		if (this.client) return [];
		if (this.connectPromise) return this.connectPromise;
		const promise = this.performInteractiveConnect(ctx, signal).finally(() => {
			this.connectPromise = undefined;
		});
		this.connectPromise = promise;
		return promise;
	}

	private async performInteractiveConnect(ctx: ExtensionContext, signal?: AbortSignal): Promise<string[]> {
		const oauthState = randomBytes(32).toString("hex");
		const callback = await startOAuthCallbackServer(oauthState, signal);
		const provider = this.createOAuthProvider(callback.redirectUrl, oauthState, async (authorizationUrl) => {
			ctx.ui.notify(`Authorize ${this.config.name} MCP in your browser: ${authorizationUrl.toString()}`, "info");
			await this.browserOpener(authorizationUrl.toString());
		});
		let attempt = this.createAttempt(provider);

		try {
			let error = await this.tryConnect(attempt, signal);
			if (error instanceof UnauthorizedError && provider.needsClientReregistration) {
				await attempt.client.close().catch(() => {});
				provider.clearForClientReregistration();
				attempt = this.createAttempt(provider);
				error = await this.tryConnect(attempt, signal);
			}
			if (error instanceof UnauthorizedError) {
				if (!provider.authorizationStarted) {
					throw new Error(`${this.config.name} MCP requires authorization but returned no authorization URL`);
				}
				const authorizationCode = await callback.code;
				await attempt.transport.finishAuth(authorizationCode);
				await attempt.client.close().catch(() => {});
				attempt = this.createAttempt(provider);
				error = await this.tryConnect(attempt, signal);
			}
			if (error) throw error;
			this.client = attempt.client;
			return await this.registerRemoteTools(signal);
		} catch (error) {
			await attempt.client.close().catch(() => {});
			throw error;
		} finally {
			callback.close();
		}
	}

	private async listRemoteTools(signal?: AbortSignal): Promise<Tool[]> {
		if (!this.client) throw new Error(`${this.config.name} MCP is not connected`);
		const tools: Tool[] = [];
		const seenCursors = new Set<string>();
		let cursor: string | undefined;
		for (let page = 0; page < 100; page += 1) {
			const result = await this.client.listTools(cursor ? { cursor } : undefined, {
				signal,
				timeout: REQUEST_TIMEOUT_MS,
			});
			tools.push(...result.tools);
			if (tools.length > MAX_MCP_TOOLS) {
				throw new Error(`${this.config.name} MCP returned more than ${MAX_MCP_TOOLS} tools`);
			}
			cursor = result.nextCursor;
			if (!cursor) return tools;
			if (seenCursors.has(cursor)) throw new Error(`${this.config.name} MCP repeated a tools cursor`);
			seenCursors.add(cursor);
		}
		throw new Error(`${this.config.name} MCP returned too many tool pages`);
	}

	private async registerRemoteTools(signal?: AbortSignal): Promise<string[]> {
		const tools = await this.listRemoteTools(signal);
		const addedToolNames: string[] = [];
		const usedNames = new Set([this.connectToolName, ...this.registeredToolNames.values()]);
		for (const tool of tools) {
			let localName = this.registeredToolNames.get(tool.name) ?? mcpToolName(this.config.name, tool.name);
			if (!this.registeredToolNames.has(tool.name) && usedNames.has(localName)) {
				localName = fitToolName(`${localName}_${shortHash(tool.name)}`);
			}
			const isNew = !this.registeredToolNames.has(tool.name);
			this.registeredToolNames.set(tool.name, localName);
			usedNames.add(localName);
			this.pi.registerTool({
				name: localName,
				label: tool.title ?? tool.name,
				description: tool.description?.trim() || `${tool.name} from the ${this.config.name} MCP server`,
				parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema),
				execute: async (_toolCallId, params, toolSignal, _onUpdate, ctx) => {
					return await this.callRemoteTool(tool.name, params, toolSignal, ctx);
				},
			});
			if (isNew) addedToolNames.push(localName);
		}
		return addedToolNames;
	}

	private async callRemoteTool(
		toolName: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<McpToolDetails>> {
		if (!this.client) await this.connectInteractive(ctx, signal);
		if (!this.client) throw new Error(`${this.config.name} MCP is not connected`);
		let result: CallToolResult | CompatibilityCallToolResult;
		try {
			result = await this.client.callTool({ name: toolName, arguments: params }, undefined, {
				signal,
				timeout: REQUEST_TIMEOUT_MS,
				resetTimeoutOnProgress: true,
			});
		} catch (error) {
			if (!(error instanceof UnauthorizedError)) throw error;
			await this.close();
			await this.connectInteractive(ctx, signal);
			if (!this.client) throw new Error(`${this.config.name} MCP is not connected`);
			result = await this.client.callTool({ name: toolName, arguments: params }, undefined, {
				signal,
				timeout: REQUEST_TIMEOUT_MS,
				resetTimeoutOnProgress: true,
			});
		}
		return convertMcpResult(result, this.config.name, toolName);
	}
}

export function createCodexPluginMcpFactory(options: CodexPluginMcpFactoryOptions): ExtensionFactory {
	return async (pi: ExtensionAPI) => {
		const pluginDataDir = getCodexPluginDataDir(options.agentDir, options.pluginRoot);
		const browserOpener = options.openBrowser ?? openBrowser;
		const connections = readCodexMcpServers(options.configPath).map((config) => {
			const stateFile = `mcp-${safeNameSegment(config.name)}-${shortHash(config.name)}.json`;
			return new CodexMcpConnection({
				config,
				pi,
				statePath: join(pluginDataDir, stateFile),
				browserOpener,
			});
		});

		for (const connection of connections) connection.registerConnectTool();
		await Promise.all(connections.map((connection) => connection.autoConnect()));
		pi.on("session_shutdown", async () => {
			await Promise.all(connections.map((connection) => connection.close()));
		});
	};
}
