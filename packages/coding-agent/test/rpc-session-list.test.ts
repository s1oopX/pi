import { describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../src/core/session-manager.ts";
import { RpcClient } from "../src/modes/rpc/rpc-client.ts";
import {
	DEFAULT_SESSION_PAGE_LIMIT,
	getSessionPage,
	MAX_SESSION_PAGE_LIMIT,
	MAX_SESSION_SEARCH_QUERY_LENGTH,
	normalizeSessionPageRequest,
} from "../src/modes/rpc/session-list-query.ts";

function makeSession(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
	return {
		path: `/sessions/${id}.jsonl`,
		id,
		cwd: overrides.cwd ?? "/workspace/default",
		name: overrides.name,
		parentSessionPath: overrides.parentSessionPath,
		created: overrides.created ?? new Date("2026-01-01T00:00:00.000Z"),
		modified: overrides.modified ?? new Date("2026-01-01T00:00:00.000Z"),
		messageCount: overrides.messageCount ?? 1,
		firstMessage: overrides.firstMessage ?? `First message for ${id}`,
		allMessagesText: overrides.allMessagesText ?? "",
	};
}

describe("RPC session list query", () => {
	it("strictly normalizes offset, limit, and query", () => {
		expect(normalizeSessionPageRequest({})).toEqual({
			offset: 0,
			limit: DEFAULT_SESSION_PAGE_LIMIT,
			query: "",
		});
		expect(normalizeSessionPageRequest({ offset: -2.8, limit: 0.8, query: "  needle  " })).toEqual({
			offset: 0,
			limit: 1,
			query: "needle",
		});
		expect(normalizeSessionPageRequest({ offset: 12.9, limit: 999 })).toEqual({
			offset: 12,
			limit: MAX_SESSION_PAGE_LIMIT,
			query: "",
		});
		expect(normalizeSessionPageRequest({ offset: Number.POSITIVE_INFINITY, limit: Number.NaN, query: 42 })).toEqual({
			offset: 0,
			limit: DEFAULT_SESSION_PAGE_LIMIT,
			query: "",
		});
		expect(
			normalizeSessionPageRequest({ query: `  ${"x".repeat(MAX_SESSION_SEARCH_QUERY_LENGTH + 20)}  ` }).query,
		).toHaveLength(MAX_SESSION_SEARCH_QUERY_LENGTH);
	});

	it("paginates an empty query without changing the incoming stable order", () => {
		const sessions = [makeSession("newest"), makeSession("newer"), makeSession("older"), makeSession("oldest")];

		expect(getSessionPage(sessions, { offset: 1, limit: 2, query: "   " })).toEqual({
			sessions: [sessions[1], sessions[2]],
			total: 4,
			hasMore: true,
			nextOffset: 3,
		});
		expect(getSessionPage(sessions, { offset: 3, limit: 2 })).toEqual({
			sessions: [sessions[3]],
			total: 4,
			hasMore: false,
			nextOffset: null,
		});
		expect(getSessionPage(sessions, { offset: 20, limit: 2 })).toEqual({
			sessions: [],
			total: 4,
			hasMore: false,
			nextOffset: null,
		});
	});

	it("searches id, name, message text, and cwd before pagination", () => {
		const sessions = [
			makeSession("idneedle"),
			makeSession("name", { name: "nameneedle" }),
			makeSession("message", { allMessagesText: "contains messageneedle here" }),
			makeSession("cwd", { cwd: "/workspace/cwdneedle" }),
		];

		for (const [query, expectedId] of [
			['"idneedle"', "idneedle"],
			['"nameneedle"', "name"],
			['"messageneedle"', "message"],
			['"cwdneedle"', "cwd"],
		] as const) {
			const result = getSessionPage(sessions, { query, limit: 1 });
			expect(result.sessions.map((session) => session.id)).toEqual([expectedId]);
			expect(result.total).toBe(1);
			expect(result.hasMore).toBe(false);
			expect(result.nextOffset).toBeNull();
		}
	});

	it("keeps recent order for matches and reports metadata from the filtered set", () => {
		const sessions = [
			makeSession("newest-match", { allMessagesText: "needle" }),
			makeSession("not-a-match", { allMessagesText: "unrelated" }),
			makeSession("older-match", { allMessagesText: "needle" }),
		];

		expect(getSessionPage(sessions, { query: "needle", limit: 1 })).toEqual({
			sessions: [sessions[0]],
			total: 2,
			hasMore: true,
			nextOffset: 1,
		});
		expect(getSessionPage(sessions, { query: "re:(", limit: 1 })).toEqual({
			sessions: [],
			total: 0,
			hasMore: false,
			nextOffset: null,
		});
	});
});

type RpcClientPrivate = {
	send: (command: {
		type: string;
		all?: boolean;
		cwd?: string;
		offset?: number;
		limit?: number;
		query?: string;
		parentSession?: string;
		sessionPath?: string;
	}) => Promise<unknown>;
	getData: <T>(response: unknown) => T;
};

describe("RpcClient getSessions", () => {
	it("sends pagination and search options and returns page metadata", async () => {
		const client = new RpcClient();
		const privateClient = client as unknown as RpcClientPrivate;
		const session = makeSession("result");
		const data = { sessions: [session], total: 3, hasMore: true, nextOffset: 2 };
		const send = vi.fn(async () => ({
			type: "response",
			command: "get_sessions",
			success: true,
			data,
		}));
		privateClient.send = send;
		privateClient.getData = <T>(response: unknown): T => (response as { data: T }).data;

		const result = await client.getSessions({
			all: true,
			cwd: "/workspace/target",
			offset: 1,
			limit: 1,
			query: "needle",
		});

		expect(send).toHaveBeenCalledWith({
			type: "get_sessions",
			all: true,
			cwd: "/workspace/target",
			offset: 1,
			limit: 1,
			query: "needle",
		});
		expect(result).toEqual(data);
	});

	it("forwards cwd when creating a session and returns cwd after session changes", async () => {
		const client = new RpcClient();
		const privateClient = client as unknown as RpcClientPrivate;
		const send = vi.fn(async (command: { type: string }) => ({
			type: "response",
			command: command.type,
			success: true,
			data: { cancelled: false, cwd: "/workspace/target" },
		}));
		privateClient.send = send;
		privateClient.getData = <T>(response: unknown): T => (response as { data: T }).data;

		await expect(client.newSession("/sessions/parent.jsonl", "/workspace/target")).resolves.toEqual({
			cancelled: false,
			cwd: "/workspace/target",
		});
		await expect(client.switchSession("/sessions/target.jsonl")).resolves.toEqual({
			cancelled: false,
			cwd: "/workspace/target",
		});
		expect(send).toHaveBeenNthCalledWith(1, {
			type: "new_session",
			parentSession: "/sessions/parent.jsonl",
			cwd: "/workspace/target",
		});
		expect(send).toHaveBeenNthCalledWith(2, {
			type: "switch_session",
			sessionPath: "/sessions/target.jsonl",
		});
	});
});
