import assert from "node:assert/strict";
import test from "node:test";
import { assertPrerequisites, launchStudio, REPLY_TIMEOUT_MS } from "./harness.mjs";

const OBJECTIVE = "Reach complete Codex Desktop parity";
const CREATED_REPLY = "Persistent goal created.";
const CONTINUED_REPLY = "Persistent goal continued.";

test("task goal: active objectives persist and enter the next turn system prompt", async (t) => {
	assertPrerequisites();

	const studio = await launchStudio({
		script: [
			{
				toolCalls: [{
					id: "goal_create_1",
					name: "create_goal",
					arguments: { objective: OBJECTIVE, token_budget: 100_000 },
				}],
			},
			{ reply: CREATED_REPLY },
			{
				toolCalls: [{ id: "goal_get_1", name: "get_goal", arguments: {} }],
			},
			{ reply: CONTINUED_REPLY },
		],
	});
	t.after(() => studio.close());

	try {
		await studio.waitUntilReady();
		await studio.sendPrompt("Start the persistent parity goal");
		await studio.page.getByText(CREATED_REPLY).first().waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });

		await studio.sendPrompt("Continue the goal");
		await studio.page.getByText(CONTINUED_REPLY).first().waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });

		assert.equal(studio.server.requests.length, 4);
		const nextTurnMessages = studio.server.requests[2].body?.messages ?? [];
		assert.ok(
			JSON.stringify(nextTurnMessages).includes(OBJECTIVE),
			"active goal objective was not injected into the next turn",
		);
		const goalToolMessages = (studio.server.requests[3].body?.messages ?? []).filter((message) => message.role === "tool");
		assert.ok(JSON.stringify(goalToolMessages).includes("Goal active"), "get_goal result did not reach the model");
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
