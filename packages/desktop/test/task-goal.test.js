import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { taskGoalExtension } from "../src/task-goal.ts";

function createHarness() {
	const branch = [];
	const handlers = new Map();
	const tools = new Map();
	let entryId = 0;
	const pi = {
		appendEntry(customType, data) {
			branch.push({
				type: "custom",
				customType,
				data,
				id: `entry-${++entryId}`,
				parentId: branch.at(-1)?.id ?? null,
				timestamp: new Date().toISOString(),
			});
		},
		on(event, handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerTool(tool) {
			tools.set(tool.name, tool);
		},
	};
	taskGoalExtension(pi);
	return {
		branch,
		handlers,
		tools,
		ctx: { sessionManager: { getBranch: () => branch } },
	};
}

describe("task goal", () => {
	it("persists, injects, accounts for, blocks, resumes, and completes a thread goal", async () => {
		const { branch, handlers, tools, ctx } = createHarness();
		const createGoal = tools.get("create_goal");
		const getGoal = tools.get("get_goal");
		const updateGoal = tools.get("update_goal");
		assert.ok(createGoal && getGoal && updateGoal);

		assert.equal((await getGoal.execute("get-0", {}, undefined, undefined, ctx)).details.goal, null);
		const created = await createGoal.execute(
			"create-1",
			{ objective: "  Ship complete Codex parity  ", token_budget: 10 },
			undefined,
			undefined,
			ctx,
		);
		assert.equal(created.details.objective, "Ship complete Codex parity");
		assert.equal(created.details.status, "active");
		await assert.rejects(
			createGoal.execute("create-2", { objective: "Replace it" }, undefined, undefined, ctx),
			/unfinished goal/,
		);

		branch.push({
			type: "message",
			id: "assistant-1",
			parentId: branch.at(-1).id,
			timestamp: new Date().toISOString(),
			message: {
				role: "assistant",
				usage: {
					input: 2,
					output: 3,
					cacheRead: 1,
					cacheWrite: 0,
					totalTokens: 6,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			},
		});
		const read = await getGoal.execute("get-1", {}, undefined, undefined, ctx);
		assert.equal(read.details.tokensUsed, 6);
		assert.equal(read.details.remainingTokens, 4);

		const injected = await handlers.get("before_agent_start")[0]({ systemPrompt: "base" }, ctx);
		assert.match(injected.systemPrompt, /^base/);
		assert.match(injected.systemPrompt, /Ship complete Codex parity/);

		const blocked = await updateGoal.execute("block", { status: "blocked" }, undefined, undefined, ctx);
		assert.equal(blocked.details.status, "blocked");
		assert.deepEqual(await handlers.get("input")[0]({ source: "rpc" }, ctx), { action: "continue" });
		assert.equal(branch.at(-1).data.status, "active");

		const completed = await updateGoal.execute("complete", { status: "complete" }, undefined, undefined, ctx);
		assert.equal(completed.details.status, "complete");
		const replacement = await createGoal.execute(
			"create-3",
			{ objective: "Next goal" },
			undefined,
			undefined,
			ctx,
		);
		assert.equal(replacement.details.objective, "Next goal");
		assert.notEqual(replacement.details.goalId, created.details.goalId);
	});
});
