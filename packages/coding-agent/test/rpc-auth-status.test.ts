import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import type { ExtensionFactory } from "../src/index.ts";
import { runRpcMode } from "../src/modes/rpc/rpc-mode.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

const rpcIo = vi.hoisted(() => ({
	outputLines: [] as string[],
	lineHandler: undefined as ((line: string) => void) | undefined,
}));

vi.mock("../src/core/output-guard.js", () => ({
	flushRawStdout: vi.fn(async () => {}),
	takeOverStdout: vi.fn(),
	waitForRawStdoutBackpressure: vi.fn(async () => {}),
	writeRawStdout: (line: string) => {
		rpcIo.outputLines.push(line);
	},
}));

vi.mock("../src/modes/interactive/theme/theme.js", () => ({ theme: {} }));

vi.mock("../src/modes/rpc/jsonl.js", () => ({
	attachJsonlLineReader: vi.fn((_stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
		rpcIo.lineHandler = onLine;
		return () => {
			rpcIo.lineHandler = undefined;
		};
	}),
	serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
}));

type NodeListener = Parameters<typeof process.on>[1];

type ListenerSnapshot = {
	stdinEnd: NodeListener[];
	signals: Map<NodeJS.Signals, NodeListener[]>;
};

function takeListenerSnapshot(): ListenerSnapshot {
	const signals: NodeJS.Signals[] = process.platform === "win32" ? ["SIGTERM"] : ["SIGTERM", "SIGHUP"];
	return {
		stdinEnd: process.stdin.listeners("end") as NodeListener[],
		signals: new Map(signals.map((signal) => [signal, process.listeners(signal) as NodeListener[]])),
	};
}

function restoreListeners(snapshot: ListenerSnapshot): void {
	for (const listener of process.stdin.listeners("end") as NodeListener[]) {
		if (!snapshot.stdinEnd.includes(listener)) process.stdin.off("end", listener);
	}
	for (const [signal, previousListeners] of snapshot.signals) {
		for (const listener of process.listeners(signal) as NodeListener[]) {
			if (!previousListeners.includes(listener)) process.off(signal, listener);
		}
	}
}

function parseOutputLines(): Array<Record<string, unknown>> {
	return rpcIo.outputLines
		.flatMap((line) => line.split("\n"))
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function createRuntimeHost(harness: Harness): AgentSessionRuntime {
	return {
		session: harness.session,
		newSession: vi.fn(async () => ({ cancelled: true })),
		switchSession: vi.fn(async () => ({ cancelled: true })),
		fork: vi.fn(async () => ({ cancelled: true, selectedText: "" })),
		dispose: vi.fn(async () => {}),
		setRebindSession: vi.fn(),
	} as unknown as AgentSessionRuntime;
}

async function sendCommand(command: Record<string, unknown>): Promise<Record<string, unknown>> {
	const id = String(command.id);
	rpcIo.lineHandler?.(JSON.stringify(command));
	let response: Record<string, unknown> | undefined;
	await vi.waitFor(() => {
		response = parseOutputLines().find((record) => record.id === id && record.type === "response");
		expect(response).toBeDefined();
	});
	return response!;
}

describe("RPC provider auth status", () => {
	afterEach(() => {
		rpcIo.outputLines = [];
		rpcIo.lineHandler = undefined;
		vi.restoreAllMocks();
	});

	it("includes model providers without auth and stored providers without models", async () => {
		const listenerSnapshot = takeListenerSnapshot();
		const harness = await createHarness();
		harness.authStorage.set("stored-only", { type: "api_key", key: "secret" });
		const model = harness.getModel();
		const modelProvider = "rpc-unauthenticated-test";
		harness.session.modelRegistry.registerProvider(modelProvider, {
			baseUrl: model.baseUrl,
			api: model.api,
			apiKey: "$PI_MISSING_RPC_AUTH_STATUS_KEY",
			models: [
				{
					id: "no-auth",
					name: "No Auth",
					reasoning: model.reasoning,
					input: model.input,
					cost: model.cost,
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
				},
			],
		});

		try {
			void runRpcMode(createRuntimeHost(harness));
			await vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined());

			const response = await sendCommand({ id: "auth", type: "get_auth_status" });
			const providers = (response.data as { providers: Record<string, unknown> }).providers;
			expect(providers[modelProvider]).toEqual({ configured: false });
			expect(providers["stored-only"]).toEqual({ configured: true, source: "stored" });

			const setResponse = await sendCommand({
				id: "set-key",
				type: "set_api_key",
				provider: modelProvider.toUpperCase(),
				apiKey: "new-secret",
			});
			expect(setResponse.data).toMatchObject({
				provider: modelProvider,
				status: { configured: true, source: "stored" },
			});
			expect(harness.authStorage.has(modelProvider)).toBe(true);
		} finally {
			harness.cleanup();
			restoreListeners(listenerSnapshot);
		}
	});

	it("lists every default session directory but keeps custom directories scoped", async () => {
		const listenerSnapshot = takeListenerSnapshot();
		const harness = await createHarness();
		const usesDefaultSessionDir = vi.spyOn(harness.sessionManager, "usesDefaultSessionDir").mockReturnValue(true);
		vi.spyOn(harness.sessionManager, "getSessionDir").mockReturnValue("C:\\custom-sessions");
		const list = vi.spyOn(SessionManager, "list").mockResolvedValue([]);
		const listAll = vi.spyOn(SessionManager, "listAll").mockResolvedValue([]);

		try {
			void runRpcMode(createRuntimeHost(harness));
			await vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined());

			await sendCommand({ id: "default-cwd", type: "get_sessions", all: true, cwd: "C:\\project-b" });
			await sendCommand({ id: "default", type: "get_sessions", all: true });
			usesDefaultSessionDir.mockReturnValue(false);
			await sendCommand({ id: "custom-cwd", type: "get_sessions", all: true, cwd: "C:\\project-c" });
			await sendCommand({ id: "custom", type: "get_sessions", all: true });

			expect(list.mock.calls).toEqual([
				["C:\\project-b", undefined],
				["C:\\project-c", "C:\\custom-sessions"],
			]);
			expect(listAll.mock.calls).toEqual([[], ["C:\\custom-sessions"]]);
		} finally {
			harness.cleanup();
			restoreListeners(listenerSnapshot);
		}
	});

	it("returns cwd in state and session replacement responses", async () => {
		const listenerSnapshot = takeListenerSnapshot();
		const harness = await createHarness();
		const runtimeHost = createRuntimeHost(harness);
		const targetCwd = "C:\\task-root";
		const resumedCwd = "C:\\project-b";
		vi.mocked(runtimeHost.newSession).mockResolvedValue({ cancelled: false, cwd: targetCwd });
		vi.mocked(runtimeHost.switchSession).mockResolvedValue({ cancelled: false, cwd: resumedCwd });

		try {
			void runRpcMode(runtimeHost);
			await vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined());

			const stateResponse = await sendCommand({ id: "state", type: "get_state" });
			expect(stateResponse.data).toMatchObject({ cwd: harness.sessionManager.getCwd() });

			const newResponse = await sendCommand({
				id: "new",
				type: "new_session",
				cwd: targetCwd,
				parentSession: "C:\\sessions\\parent.jsonl",
			});
			expect(runtimeHost.newSession).toHaveBeenCalledWith({
				cwd: targetCwd,
				parentSession: "C:\\sessions\\parent.jsonl",
			});
			expect(newResponse.data).toEqual({ cancelled: false, cwd: targetCwd });

			const switchResponse = await sendCommand({
				id: "switch",
				type: "switch_session",
				sessionPath: "C:\\sessions\\project-b.jsonl",
			});
			expect(runtimeHost.switchSession).toHaveBeenCalledWith("C:\\sessions\\project-b.jsonl");
			expect(switchResponse.data).toEqual({ cancelled: false, cwd: resumedCwd });
		} finally {
			harness.cleanup();
			restoreListeners(listenerSnapshot);
		}
	});

	it("emits session_changed for extension replacements before new-session events", async () => {
		const listenerSnapshot = takeListenerSnapshot();
		const extensionFactory: ExtensionFactory = (pi) => {
			pi.registerCommand("replace", {
				description: "replace",
				handler: async (_args, ctx) => {
					await ctx.newSession({
						withSession: async (replacedCtx) => {
							await replacedCtx.sendMessage({
								customType: "replacement-ready",
								content: "replacement ready",
								display: true,
							});
						},
					});
				},
			});
		};
		const harnesses = await Promise.all(
			[1, 2, 3].map(() => createHarness({ extensionFactories: [extensionFactory] })),
		);
		let currentIndex = 0;
		type RebindSession = NonNullable<Parameters<AgentSessionRuntime["setRebindSession"]>[0]>;
		let rebindSession: RebindSession | undefined;
		const runtimeHost = {
			get session() {
				return harnesses[currentIndex].session;
			},
			newSession: vi.fn(async (options?: Parameters<AgentSessionRuntime["newSession"]>[0]) => {
				currentIndex += 1;
				await rebindSession?.(harnesses[currentIndex].session, {
					hasWithSession: options?.withSession !== undefined,
				});
				await options?.withSession?.(harnesses[currentIndex].session.createReplacedSessionContext());
				return { cancelled: false, cwd: harnesses[currentIndex].session.sessionManager.getCwd() };
			}),
			switchSession: vi.fn(async () => ({
				cancelled: true,
				cwd: harnesses[currentIndex].session.sessionManager.getCwd(),
			})),
			fork: vi.fn(async () => ({ cancelled: true, selectedText: "" })),
			dispose: vi.fn(async () => {}),
			setRebindSession: vi.fn((callback: RebindSession) => {
				rebindSession = callback;
			}),
		} as unknown as AgentSessionRuntime;

		try {
			void runRpcMode(runtimeHost);
			await vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined());

			await sendCommand({ id: "direct", type: "new_session" });
			expect(parseOutputLines().filter((record) => record.type === "session_changed")).toHaveLength(0);

			const promptStartedAt = parseOutputLines().length;
			await sendCommand({ id: "extension", type: "prompt", message: "/replace" });
			const promptOutput = parseOutputLines().slice(promptStartedAt);
			const changedIndex = promptOutput.findIndex((record) => record.type === "session_changed");
			const replacementMessageIndex = promptOutput.findIndex(
				(record) =>
					record.type === "message_start" &&
					(record.message as { customType?: string } | undefined)?.customType === "replacement-ready",
			);
			const responseIndex = promptOutput.findIndex(
				(record) => record.id === "extension" && record.type === "response",
			);
			expect(changedIndex).toBeGreaterThanOrEqual(0);
			expect(replacementMessageIndex).toBeGreaterThan(changedIndex);
			expect(responseIndex).toBeGreaterThan(changedIndex);
			expect(promptOutput[changedIndex]).toMatchObject({
				type: "session_changed",
				cwd: harnesses[2].session.sessionManager.getCwd(),
				sessionId: harnesses[2].session.sessionId,
				reason: "extension_command",
			});
		} finally {
			for (const harness of harnesses) harness.cleanup();
			restoreListeners(listenerSnapshot);
		}
	});
});
