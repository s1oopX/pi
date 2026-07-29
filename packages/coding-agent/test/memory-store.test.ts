import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	appendMemoryContext,
	collectMemoryConversation,
	ensureSessionMemorySettings,
	formatMemoryContext,
	MemoryStore,
	parseMemoryCandidates,
	sessionHasMemoryContext,
	sessionHasUserMessage,
} from "../src/core/memory-store.ts";
import { SessionManager } from "../src/core/session-manager.ts";

describe("MemoryStore", () => {
	let directory: string;

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "pi-memory-"));
	});

	afterEach(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	it("parses JSON arrays and rejects prose", () => {
		expect(parseMemoryCandidates('```json\n["Likes dark mode", "likes dark mode", 4]\n```')).toEqual([
			"Likes dark mode",
		]);
		expect(parseMemoryCandidates("Here are the memories: none")).toEqual([]);
	});

	it("merges concurrently, deduplicates, caps, and resets", async () => {
		const store = new MemoryStore(join(directory, "memories.json"));
		await Promise.all([
			store.merge(["Uses TypeScript", "Uses TypeScript"]),
			store.merge(["uses typescript", "Prefers concise replies"]),
		]);

		expect(store.read().map((memory) => memory.text.toLocaleLowerCase())).toEqual(
			expect.arrayContaining(["uses typescript", "prefers concise replies"]),
		);
		await store.merge(Array.from({ length: 105 }, (_, index) => `Fact ${index}`));
		expect(store.read()).toHaveLength(100);
		await store.reset();
		expect(store.read()).toEqual([]);
	});

	it("locks memory context to a new session before the first user message", () => {
		const manager = SessionManager.inMemory();
		const defaults = { useMemories: true, generateMemories: true };
		expect(ensureSessionMemorySettings(manager, defaults)).toEqual(defaults);

		const memories = [{ id: "1", text: "Prefers concise replies", createdAt: new Date().toISOString() }];
		expect(appendMemoryContext(manager, memories)).toBe(true);
		expect(sessionHasMemoryContext(manager)).toBe(true);
		expect(formatMemoryContext(memories)).toContain("Prefers concise replies");
		expect(appendMemoryContext(manager, memories)).toBe(false);

		manager.appendMessage({ role: "user", content: "Hello", timestamp: Date.now() });
		expect(sessionHasUserMessage(manager)).toBe(true);
	});

	it("collects user and assistant text without tool output", () => {
		const manager = SessionManager.inMemory();
		manager.appendMessage({ role: "user", content: "Remember that I use tabs", timestamp: Date.now() });
		const assistant: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "I will remember that." }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "test",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};
		manager.appendMessage(assistant);

		expect(collectMemoryConversation(manager)).toEqual({
			text: "User: Remember that I use tabs\n\nAssistant: I will remember that.",
			toolAssisted: false,
		});
	});
});
