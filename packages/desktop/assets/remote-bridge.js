import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

const PERMISSION_FLAG = "permission-mode";
const GOAL_ENTRY = "pi-studio-goal";
const WRITE_TOOLS = new Set(["edit", "write", "multiedit"]);
const RISKY_BASH = [
	/\brm\s+(?:-\w*[rf]|--recursive|--force)/i,
	/\b(?:sudo|doas)\b/i,
	/\b(?:chmod|chown)\b[^\n]*\b777\b/i,
	/\b(?:chmod|chown)\b\s+-\w*[rR]\b/i,
	/\bgit\s+push\b[^\n]*(?:--force|-f|\s\+)/i,
	/\b(?:mkfs|fdisk)\b/i,
	/\bdd\b[^\n]*\bof=/i,
	/:\s*\(\s*\)\s*\{[^}]*\|/,
	/>\s*\/dev\/(?:sd|nvme|disk)/i,
	/\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i,
];

function permissionMode(value) {
	return value === "full" || value === "auto" ? value : "ask";
}

function outsideWorkspace(cwd, targetPath) {
	if (!cwd) return false;
	const absolute = isAbsolute(targetPath) ? targetPath : resolve(cwd, targetPath);
	const rel = relative(resolve(cwd), absolute);
	return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

export function evaluateToolApproval(event, cwd, mode) {
	if (mode === "full") return { gate: false, title: "", detail: "" };
	const input = event.input ?? {};
	if (event.toolName === "bash") {
		const command = String(input.command ?? "");
		const risky = RISKY_BASH.some((pattern) => pattern.test(command));
		return {
			gate: mode === "ask" || risky,
			title: risky ? "Run a potentially dangerous command?" : "Run command?",
			detail: command,
		};
	}
	if (WRITE_TOOLS.has(event.toolName)) {
		const targetPath = String(input.path ?? "");
		const outside = outsideWorkspace(cwd, targetPath);
		const verb = event.toolName === "write" ? "Write" : "Edit";
		return {
			gate: mode === "ask" || outside,
			title: outside ? `${verb} a file outside the workspace?` : `${verb} file?`,
			detail: targetPath,
		};
	}
	if (event.toolName === "computer_use") {
		const action = String(input.action ?? "");
		const readOnly = action === "screenshot" || action === "wait";
		return {
			gate: mode === "ask" || !readOnly,
			title: readOnly ? "Share the screen with the agent?" : "Let the agent control the computer?",
			detail: action || "computer action",
		};
	}
	if (event.toolName === "generate_image") {
		const prompt = String(input.prompt ?? "").replace(/\s+/g, " ").trim();
		return {
			gate: true,
			title: "Generate an image?",
			detail: prompt.length > 240 ? `${prompt.slice(0, 239)}…` : prompt,
		};
	}
	return { gate: false, title: "", detail: "" };
}

function currentGoal(entries) {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		const state = entry?.type === "custom" && entry.customType === GOAL_ENTRY ? entry.data : undefined;
		if (
			state?.version === 1 &&
			typeof state.goalId === "string" &&
			typeof state.objective === "string" &&
			["active", "complete", "blocked"].includes(state.status)
		) return state;
	}
	return undefined;
}

function usageTokens(usage) {
	if (!usage) return 0;
	return Number(usage.totalTokens) || ["input", "output", "cacheRead", "cacheWrite"]
		.reduce((total, key) => total + (Number(usage[key]) || 0), 0);
}

function entryTokens(entry) {
	if (entry.type === "message") {
		if (entry.message?.role === "assistant" || entry.message?.role === "toolResult") {
			return usageTokens(entry.message.usage);
		}
	}
	if (entry.type === "branch_summary" || entry.type === "compaction") return usageTokens(entry.usage);
	return 0;
}

function goalDetails(entries, state) {
	const createdIndex = entries.findIndex((entry) =>
		entry.type === "custom" && entry.customType === GOAL_ENTRY && entry.data?.goalId === state.goalId);
	const tokensUsed = entries.slice(Math.max(0, createdIndex + 1)).reduce((total, entry) => total + entryTokens(entry), 0);
	return {
		...state,
		tokensUsed,
		...(state.tokenBudget === undefined ? {} : { remainingTokens: Math.max(0, state.tokenBudget - tokensUsed) }),
		elapsedMs: Math.max(0, Date.now() - Date.parse(state.createdAt)),
	};
}

function goalResult(details) {
	return {
		content: [{
			type: "text",
			text: `Goal ${details.status}: ${details.tokensUsed} tokens used${details.tokenBudget === undefined ? "" : `, ${details.remainingTokens} remaining`}.`,
		}],
		details,
	};
}

function registerApproval(pi) {
	pi.registerFlag(PERMISSION_FLAG, {
		type: "string",
		description: "Tool approval mode: full, auto, or ask.",
		default: "ask",
	});
	pi.on("tool_call", async (event, ctx) => {
		const decision = evaluateToolApproval(event, ctx.cwd, permissionMode(pi.getFlag(PERMISSION_FLAG)));
		if (!decision.gate) return undefined;
		if (!ctx.hasUI) return { block: true, reason: `${decision.title} No approval UI is available.` };
		return await ctx.ui.confirm(decision.title, decision.detail)
			? undefined
			: { block: true, reason: "The action was not approved." };
	});
}

function registerPlan(pi) {
	pi.registerTool({
		name: "update_plan",
		label: "Update plan",
		description: "Create or replace the current task plan shown in Pi Studio.",
		promptSnippet: "Create or update the task plan shown in Pi Studio",
		promptGuidelines: [
			"Use update_plan for complex tasks with multiple meaningful steps; skip it for simple requests.",
			"Keep at most one plan step in_progress while work remains.",
		],
		parameters: {
			type: "object",
			properties: {
				explanation: { type: "string" },
				plan: {
					type: "array",
					items: {
						type: "object",
						properties: {
							step: { type: "string", minLength: 1 },
							status: { type: "string", enum: ["pending", "in_progress", "completed"] },
						},
						required: ["step", "status"],
						additionalProperties: false,
					},
				},
			},
			required: ["plan"],
			additionalProperties: false,
		},
		async execute(_toolCallId, params) {
			const completed = params.plan.filter((step) => step.status === "completed").length;
			return { content: [{ type: "text", text: `Plan updated: ${completed}/${params.plan.length} completed.` }] };
		},
	});
}

function registerGoals(pi) {
	pi.on("input", (event, ctx) => {
		const state = currentGoal(ctx.sessionManager.getBranch());
		if (state?.status === "blocked" && event.source !== "extension") {
			pi.appendEntry(GOAL_ENTRY, { ...state, status: "active", updatedAt: new Date().toISOString() });
		}
		return { action: "continue" };
	});
	pi.on("before_agent_start", (event, ctx) => {
		const entries = ctx.sessionManager.getBranch();
		const state = currentGoal(entries);
		if (state?.status !== "active") return undefined;
		const details = goalDetails(entries, state);
		const budget = details.tokenBudget === undefined
			? "No token budget was requested."
			: `Token budget: ${details.tokenBudget}; used: ${details.tokensUsed}; remaining: ${details.remainingTokens}.`;
		return {
			systemPrompt: `${event.systemPrompt}\n\n# Active thread goal\n\nObjective (JSON string): ${JSON.stringify(details.objective)}\n\n${budget}\nContinue until every explicit requirement is genuinely complete. Use update_goal only for genuine completion or a repeated blocker.`,
		};
	});
	pi.registerTool({
		name: "create_goal",
		label: "Create goal",
		description: "Create a persistent goal only when the user explicitly requests one.",
		promptSnippet: "Create a persistent thread goal only when explicitly requested",
		parameters: {
			type: "object",
			properties: {
				objective: { type: "string", minLength: 1, maxLength: 20000 },
				token_budget: { type: "integer", minimum: 1 },
			},
			required: ["objective"],
			additionalProperties: false,
		},
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const entries = ctx.sessionManager.getBranch();
			const existing = currentGoal(entries);
			if (existing && existing.status !== "complete") throw new Error("An unfinished goal already exists");
			const objective = params.objective.trim();
			if (!objective) throw new Error("objective is required");
			const now = new Date().toISOString();
			const state = {
				version: 1,
				goalId: randomUUID(),
				objective,
				status: "active",
				...(params.token_budget === undefined ? {} : { tokenBudget: params.token_budget }),
				createdAt: now,
				updatedAt: now,
			};
			pi.appendEntry(GOAL_ENTRY, state);
			return goalResult(goalDetails(ctx.sessionManager.getBranch(), state));
		},
	});
	pi.registerTool({
		name: "get_goal",
		label: "Get goal",
		description: "Read the persistent goal and its elapsed and token usage.",
		promptSnippet: "Inspect the current persistent thread goal",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const entries = ctx.sessionManager.getBranch();
			const state = currentGoal(entries);
			return state
				? goalResult(goalDetails(entries, state))
				: { content: [{ type: "text", text: "No goal exists for this thread." }], details: { goal: null } };
		},
	});
	pi.registerTool({
		name: "update_goal",
		label: "Update goal",
		description: "Mark the current goal complete or genuinely blocked.",
		promptSnippet: "Complete or block the current persistent thread goal",
		parameters: {
			type: "object",
			properties: { status: { type: "string", enum: ["complete", "blocked"] } },
			required: ["status"],
			additionalProperties: false,
		},
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const entries = ctx.sessionManager.getBranch();
			const state = currentGoal(entries);
			if (!state) throw new Error("No goal exists for this thread");
			if (state.status === "complete") throw new Error("The current goal is already complete");
			const updated = { ...state, status: params.status, updatedAt: new Date().toISOString() };
			pi.appendEntry(GOAL_ENTRY, updated);
			return goalResult(goalDetails(entries, updated));
		},
	});
}

export default function remoteBridge(pi) {
	registerApproval(pi);
	registerPlan(pi);
	registerGoals(pi);
}
