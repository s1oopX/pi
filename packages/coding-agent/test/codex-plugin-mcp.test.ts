import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCodexPluginMcpFactory } from "../src/core/codex-plugin-mcp.ts";
import { createEventBus } from "../src/core/event-bus.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.ts";
import type { Extension, ExtensionContext } from "../src/core/extensions/types.ts";
import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

interface TestServer {
	url: string;
	close(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	return Buffer.concat(chunks).toString("utf-8");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
	response.statusCode = statusCode;
	response.setHeader("content-type", "application/json");
	response.end(JSON.stringify(body));
}

async function handleMcpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
	if (request.method !== "POST") {
		sendJson(response, 405, { error: "method not allowed" });
		return;
	}
	const rawBody = await readRequestBody(request);
	const body = rawBody ? (JSON.parse(rawBody) as unknown) : undefined;
	const server = new McpServer({ name: "test-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: [
			{
				name: "echo",
				description: "Echo text and return non-Pi MCP content types",
				inputSchema: {
					type: "object",
					properties: { message: { type: "string" } },
					required: ["message"],
				},
			},
		],
	}));
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const message =
			isRecord(request.params.arguments) && typeof request.params.arguments.message === "string"
				? request.params.arguments.message
				: "";
		return {
			content: [
				{ type: "text" as const, text: `echo:${message}` },
				{ type: "audio" as const, data: "YXVkaW8=", mimeType: "audio/wav" },
				{
					type: "resource" as const,
					resource: { uri: "test://resource", text: "resource text", mimeType: "text/plain" },
				},
			],
			structuredContent: { echoed: message },
		};
	});
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
	await server.connect(transport);
	response.once("close", () => {
		void transport.close();
		void server.close();
	});
	await transport.handleRequest(request, response, body);
}

async function startOAuthMcpServer(): Promise<TestServer> {
	let baseUrl = "";
	const server = createServer((request, response) => {
		void (async () => {
			const requestUrl = new URL(request.url ?? "/", baseUrl);
			if (requestUrl.pathname === "/resource-metadata") {
				sendJson(response, 200, {
					resource: `${baseUrl}/mcp`,
					authorization_servers: [baseUrl],
					scopes_supported: ["mcp"],
				});
				return;
			}
			if (requestUrl.pathname === "/.well-known/oauth-authorization-server") {
				sendJson(response, 200, {
					issuer: baseUrl,
					authorization_endpoint: `${baseUrl}/authorize`,
					token_endpoint: `${baseUrl}/token`,
					registration_endpoint: `${baseUrl}/register`,
					response_types_supported: ["code"],
					grant_types_supported: ["authorization_code", "refresh_token"],
					code_challenge_methods_supported: ["S256"],
					token_endpoint_auth_methods_supported: ["none"],
				});
				return;
			}
			if (requestUrl.pathname === "/register") {
				const body = JSON.parse(await readRequestBody(request)) as unknown;
				sendJson(response, 201, {
					...(isRecord(body) ? body : {}),
					client_id: "pi-studio-test-client",
					token_endpoint_auth_method: "none",
				});
				return;
			}
			if (requestUrl.pathname === "/authorize") {
				const redirect = new URL(requestUrl.searchParams.get("redirect_uri") ?? "");
				redirect.searchParams.set("code", "test-authorization-code");
				redirect.searchParams.set("state", requestUrl.searchParams.get("state") ?? "");
				response.statusCode = 302;
				response.setHeader("location", redirect.toString());
				response.end();
				return;
			}
			if (requestUrl.pathname === "/token") {
				const params = new URLSearchParams(await readRequestBody(request));
				if (!new Set(["authorization_code", "refresh_token"]).has(params.get("grant_type") ?? "")) {
					sendJson(response, 400, { error: "unsupported_grant_type" });
					return;
				}
				sendJson(response, 200, {
					access_token: "test-access-token",
					refresh_token: "test-refresh-token",
					token_type: "Bearer",
					expires_in: 3600,
				});
				return;
			}
			if (requestUrl.pathname === "/mcp") {
				if (request.headers.authorization !== "Bearer test-access-token") {
					response.statusCode = 401;
					response.setHeader("www-authenticate", `Bearer resource_metadata="${baseUrl}/resource-metadata"`);
					response.end();
					return;
				}
				await handleMcpRequest(request, response);
				return;
			}
			sendJson(response, 404, { error: "not found" });
		})().catch((error: unknown) => {
			if (!response.headersSent)
				sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
			else response.end();
		});
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Could not determine test MCP port");
	baseUrl = `http://127.0.0.1:${address.port}`;
	return {
		url: `${baseUrl}/mcp`,
		close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
	};
}

function createExtensionContext(): ExtensionContext {
	return {
		ui: { notify: () => {} },
	} as unknown as ExtensionContext;
}

async function closeExtension(extension: Extension): Promise<void> {
	for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler();
}

describe("Codex plugin MCP", () => {
	let tempDir: string;
	let agentDir: string;
	let cwd: string;
	let pluginDir: string;
	let configPath: string;
	let testServer: TestServer;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `codex-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		cwd = join(tempDir, "project");
		pluginDir = join(tempDir, "plugin");
		configPath = join(pluginDir, ".mcp.json");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
		mkdirSync(join(pluginDir, ".codex-plugin"), { recursive: true });
		testServer = await startOAuthMcpServer();
		writeFileSync(
			join(pluginDir, ".codex-plugin", "plugin.json"),
			JSON.stringify({ name: "test-mcp", version: "1.0.0", mcpServers: "./.mcp.json" }),
		);
		writeFileSync(
			configPath,
			JSON.stringify({ mcpServers: { "test-server": { type: "http", url: testServer.url } } }),
		);
	});

	afterEach(async () => {
		await testServer.close();
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("discovers HTTP MCP config, completes OAuth, persists tokens, and restores tools", async () => {
		const settingsManager = SettingsManager.inMemory();
		const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
		const resolved = await packageManager.resolveExtensionSources([pluginDir]);
		expect(resolved.mcpServers).toEqual([
			{
				path: configPath,
				enabled: true,
				metadata: { source: pluginDir, scope: "user", origin: "package", baseDir: pluginDir },
			},
		]);

		let browserOpenCount = 0;
		const browserOpener = async (authorizationUrl: string) => {
			browserOpenCount += 1;
			const response = await fetch(authorizationUrl, { redirect: "manual" });
			const location = response.headers.get("location");
			if (!location) throw new Error("Test OAuth server returned no callback location");
			await fetch(location);
		};
		const firstRuntime = createExtensionRuntime();
		const firstExtension = await loadExtensionFromFactory(
			createCodexPluginMcpFactory({ configPath, pluginRoot: pluginDir, agentDir, openBrowser: browserOpener }),
			cwd,
			createEventBus(),
			firstRuntime,
			configPath,
		);
		const connectTool = firstExtension.tools.get("mcp__test-server__connect");
		expect(connectTool).toBeDefined();
		const connectResult = await connectTool!.definition.execute(
			"connect",
			{},
			undefined,
			undefined,
			createExtensionContext(),
		);
		expect(browserOpenCount).toBe(1);
		expect(connectResult.addedToolNames).toEqual(["mcp__test-server__echo"]);

		const echoTool = firstExtension.tools.get("mcp__test-server__echo");
		expect(echoTool).toBeDefined();
		const echoResult = await echoTool!.definition.execute(
			"echo",
			{ message: "hello" },
			undefined,
			undefined,
			createExtensionContext(),
		);
		expect(echoResult.content[0]).toEqual({ type: "text", text: "echo:hello" });
		expect(echoResult.content.some((item) => item.type === "text" && item.text.includes('"type": "audio"'))).toBe(
			true,
		);
		expect(echoResult.content.some((item) => item.type === "text" && item.text.includes("test://resource"))).toBe(
			true,
		);
		expect(echoResult.content.some((item) => item.type === "text" && item.text.includes('"echoed": "hello"'))).toBe(
			true,
		);

		const pluginDataDirs = readdirSync(join(agentDir, "plugin-data"));
		const stateFiles = readdirSync(join(agentDir, "plugin-data", pluginDataDirs[0]!));
		const statePath = join(
			agentDir,
			"plugin-data",
			pluginDataDirs[0]!,
			stateFiles.find((name) => name.startsWith("mcp-test-server-"))!,
		);
		const state = JSON.parse(readFileSync(statePath, "utf-8")) as Record<string, unknown>;
		expect(state.tokens).toMatchObject({ access_token: "test-access-token", refresh_token: "test-refresh-token" });
		await closeExtension(firstExtension);

		const secondExtension = await loadExtensionFromFactory(
			createCodexPluginMcpFactory({ configPath, pluginRoot: pluginDir, agentDir, openBrowser: browserOpener }),
			cwd,
			createEventBus(),
			createExtensionRuntime(),
			configPath,
		);
		expect(secondExtension.tools.has("mcp__test-server__echo")).toBe(true);
		expect(browserOpenCount).toBe(1);
		await closeExtension(secondExtension);
	});
});
