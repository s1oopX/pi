import type { SessionInfo } from "../../core/session-manager.ts";
import { filterAndSortSessions } from "../interactive/components/session-selector-search.ts";

export const DEFAULT_SESSION_PAGE_LIMIT = 40;
export const MAX_SESSION_PAGE_LIMIT = 200;
export const MAX_SESSION_SEARCH_QUERY_LENGTH = 1000;

export interface SessionPageRequest {
	offset?: unknown;
	limit?: unknown;
	query?: unknown;
}

export interface NormalizedSessionPageRequest {
	offset: number;
	limit: number;
	query: string;
}

export interface SessionPage {
	sessions: SessionInfo[];
	total: number;
	hasMore: boolean;
	nextOffset: number | null;
}

function normalizeInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.max(minimum, Math.min(Math.trunc(value), maximum));
}

export function normalizeSessionPageRequest(request: SessionPageRequest): NormalizedSessionPageRequest {
	return {
		offset: normalizeInteger(request.offset, 0, 0, Number.MAX_SAFE_INTEGER),
		limit: normalizeInteger(request.limit, DEFAULT_SESSION_PAGE_LIMIT, 1, MAX_SESSION_PAGE_LIMIT),
		query: typeof request.query === "string" ? request.query.trim().slice(0, MAX_SESSION_SEARCH_QUERY_LENGTH) : "",
	};
}

export function getSessionPage(sessions: SessionInfo[], request: SessionPageRequest): SessionPage {
	const { offset, limit, query } = normalizeSessionPageRequest(request);
	const filtered = filterAndSortSessions(sessions, query, "recent");
	const page = filtered.slice(offset, offset + limit);
	const total = filtered.length;
	const hasMore = offset + page.length < total;

	return {
		sessions: page,
		total,
		hasMore,
		nextOffset: hasMore ? offset + page.length : null,
	};
}
