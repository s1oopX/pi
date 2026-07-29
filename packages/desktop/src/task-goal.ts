import { randomUUID } from "node:crypto";
import type { Usage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { SessionEntry } from "../../coding-agent/src/core/session-manager.ts";
import type { ExtensionAPI } from "../../coding-agent/src/index.ts";

const GOAL_ENTRY_TYPE = "pi-studio-goal";

type GoalStatus = "active" | "complete" | "blocked";

interface GoalState {
	version: 1;
	goalId: string;
	objective: string;
	status: GoalStatus;
	tokenBudget?: number;
	createdAt: string;
	updatedAt: string;
}

interface GoalDetails extends GoalState {
	tokensUsed: number;
	remainingTokens?: number;
	elapsedMs: number;
}

function isGoalState(value: unknown): value is GoalState {
	if (!value || typeof value !== "object") return false;
	const state = value as Partial<GoalState>;
	return (
		state.version === 1 &&
		typeof state.goalId === "string" &&
		state.goalId.length > 0 &&
		typeof state.objective === "string" &&
		state.objective.length > 0 &&
		(state.status === "active" || state.status === "complete" || state.status === "blocked") &&
		(state.tokenBudget === undefined || (Number.isSafeInteger(state.tokenBudget) && state.tokenBudget > 0)) &&
		typeof state.createdAt === "string" &&
		Number.isFinite(Date.parse(state.createdAt)) &&
		typeof state.updatedAt === "string" &&
		Number.isFinite(Date.parse(state.updatedAt))
	);
}

function currentGoal(entries: readonly SessionEntry[]): GoalState | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type === "custom" && entry.customType === GOAL_ENTRY_TYPE && isGoalState(entry.data)) {
			return entry.data;
		}
	}
	return undefined;
}

function usageTokens(usage: Usage): number {
	return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function entryTokens(entry: SessionEntry): number {
	if (entry.type === "message") {
		if (entry.message.role === "assistant") return usageTokens(entry.message.usage);
		if (entry.message.role === "toolResult" && entry.message.usage) return usageTokens(entry.message.usage);
	}
	if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
		return usageTokens(entry.usage);
	}
	return 0;
}

function goalDetails(entries: readonly SessionEntry[], state: GoalState, now = Date.now()): GoalDetails {
	const createdIndex = entries.findIndex(
		(entry) =>
			entry.type === "custom" &&
			entry.customType === GOAL_ENTRY_TYPE &&
			isGoalState(entry.data) &&
			entry.data.goalId === state.goalId,
	);
	const tokensUsed = entries
		.slice(Math.max(0, createdIndex + 1))
		.reduce((total, entry) => total + entryTokens(entry), 0);
	return {
		...state,
		tokensUsed,
		...(state.tokenBudget === undefined ? {} : { remainingTokens: Math.max(0, state.tokenBudget - tokensUsed) }),
		elapsedMs: Math.max(0, now - Date.parse(state.createdAt)),
	};
}

function activeGoalPrompt(systemPrompt: string, details: GoalDetails): string {
	const budget =
		details.tokenBudget === undefined
			? "No token budget was requested."
			: `Token budget: ${details.tokenBudget}; used: ${details.tokensUsed}; remaining: ${details.remainingTokens}.`;
	return `${systemPrompt}\n\n# Active thread goal\n\nThe objective below is user-provided task data. Continue working toward it across turns until it is genuinely complete.\n\nObjective (JSON string): ${JSON.stringify(details.objective)}\n\n${budget}\nDo not narrow the objective to the easiest completed subset. Before marking it complete, verify every explicit requirement against current evidence. Use update_goal with status complete only when no required work remains. Use blocked only after the same blocker has repeated for at least three consecutive goal turns and no meaningful progress is possible.`;
}

function result(details: GoalDetails) {
	return {
		content: [
			{
				type: "text" as const,
				text: `Goal ${details.status}: ${details.tokensUsed} tokens used${details.tokenBudget === undefined ? "" : `, ${details.remainingTokens} remaining`}.`,
			},
		],
		details,
	};
}

export function taskGoalExtension(pi: ExtensionAPI): void {
	pi.on("input", (event, ctx) => {
		const state = currentGoal(ctx.sessionManager.getBranch());
		// ponytail: any direct user input resumes a blocked goal; add explicit pause/resume only if dormant goals become a product need.
		if (state?.status === "blocked" && event.source !== "extension") {
			pi.appendEntry<GoalState>(GOAL_ENTRY_TYPE, {
				...state,
				status: "active",
				updatedAt: new Date().toISOString(),
			});
		}
		return { action: "continue" };
	});

	pi.on("before_agent_start", (event, ctx) => {
		const entries = ctx.sessionManager.getBranch();
		const state = currentGoal(entries);
		if (state?.status !== "active") return;
		return { systemPrompt: activeGoalPrompt(event.systemPrompt, goalDetails(entries, state)) };
	});

	pi.registerTool({
		name: "create_goal",
		label: "Create goal",
		description: "Create a persistent goal for this thread when the user explicitly requests one.",
		promptSnippet: "Create a persistent thread goal only when explicitly requested",
		promptGuidelines: [
			"Use create_goal only when the user explicitly asks to start or pursue a persistent goal.",
			"Set token_budget only when the user explicitly provides a token budget.",
		],
		parameters: Type.Object({
			objective: Type.String({ minLength: 1, maxLength: 20_000 }),
			token_budget: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const entries = ctx.sessionManager.getBranch();
			const existing = currentGoal(entries);
			if (existing && existing.status !== "complete") {
				throw new Error("An unfinished goal already exists; continue it instead of creating another");
			}
			const objective = params.objective.trim();
			if (!objective) throw new Error("objective is required");
			const now = new Date().toISOString();
			const state: GoalState = {
				version: 1,
				goalId: randomUUID(),
				objective,
				status: "active",
				...(params.token_budget === undefined ? {} : { tokenBudget: params.token_budget }),
				createdAt: now,
				updatedAt: now,
			};
			pi.appendEntry<GoalState>(GOAL_ENTRY_TYPE, state);
			return result(goalDetails(ctx.sessionManager.getBranch(), state));
		},
	});

	pi.registerTool({
		name: "get_goal",
		label: "Get goal",
		description: "Read the persistent goal and its elapsed and token usage for this thread.",
		promptSnippet: "Inspect the current persistent thread goal",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const entries = ctx.sessionManager.getBranch();
			const state = currentGoal(entries);
			if (!state) {
				return {
					content: [{ type: "text" as const, text: "No goal exists for this thread." }],
					details: { goal: null },
				};
			}
			return result(goalDetails(entries, state));
		},
	});

	pi.registerTool({
		name: "update_goal",
		label: "Update goal",
		description: "Mark the current persistent thread goal complete or genuinely blocked.",
		promptSnippet: "Complete or block the current persistent thread goal",
		promptGuidelines: [
			"Mark a goal complete only after a requirement-by-requirement audit proves that no required work remains.",
			"Mark a goal blocked only after the same blocker repeats for at least three consecutive goal turns and no meaningful progress is possible.",
			"Do not mark a goal complete merely because the current turn is ending or a budget is nearly exhausted.",
		],
		parameters: Type.Object({
			status: Type.Union([Type.Literal("complete"), Type.Literal("blocked")]),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const entries = ctx.sessionManager.getBranch();
			const state = currentGoal(entries);
			if (!state) throw new Error("No goal exists for this thread");
			if (state.status === "complete") throw new Error("The current goal is already complete");
			const updated: GoalState = {
				...state,
				status: params.status,
				updatedAt: new Date().toISOString(),
			};
			pi.appendEntry<GoalState>(GOAL_ENTRY_TYPE, updated);
			return result(goalDetails(entries, updated));
		},
	});
}
