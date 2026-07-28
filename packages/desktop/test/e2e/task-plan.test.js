import assert from "node:assert/strict";
import test from "node:test";
import { assertPrerequisites, launchStudio, LAUNCH_TIMEOUT_MS, REPLY_TIMEOUT_MS } from "./harness.mjs";

const INITIAL_REPLY = "Initial plan recorded.";
const UPDATED_REPLY = "Plan advanced.";

test("task plan: update_plan calls render and replace the live workbench plan", async (t) => {
	assertPrerequisites();

	const studio = await launchStudio({
		script: [
			{
				toolCalls: [{
					id: "plan_1",
					name: "update_plan",
					arguments: {
						explanation: "Initial plan",
						plan: [
							{ step: "Inspect flow", status: "completed" },
							{ step: "Implement panel", status: "in_progress" },
							{ step: "Verify behavior", status: "pending" },
						],
					},
				}],
			},
			{ reply: INITIAL_REPLY },
			{
				toolCalls: [{
					id: "plan_2",
					name: "update_plan",
					arguments: {
						explanation: "Plan advanced",
						plan: [
							{ step: "Inspect flow", status: "completed" },
							{ step: "Implement panel", status: "completed" },
							{ step: "Verify behavior", status: "in_progress" },
						],
					},
				}],
			},
			{ reply: UPDATED_REPLY, delayMs: 3000 },
		],
	});
	t.after(() => studio.close());

	try {
		await studio.waitUntilReady();
		await studio.sendPrompt("Create the plan");
		await studio.page.getByText(INITIAL_REPLY).first().waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });

		await studio.page.locator(".top-bar-workbench-toggle").click();
		await studio.page.locator('[data-workbench-view="plan"]').click();
		const plan = studio.page.locator(".workbench-plan");
		await plan.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await plan.getByText("Initial plan", { exact: true }).waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		assert.equal(await plan.locator("progress").getAttribute("value"), "1");
		assert.equal(await plan.locator(".workbench-plan-step.completed").count(), 1);
		assert.equal(await plan.locator(".workbench-plan-step.in_progress").count(), 1);
		assert.equal(await plan.locator(".workbench-plan-step.pending").count(), 1);

		await studio.sendPrompt("Advance the plan");
		await plan.getByText("Plan advanced", { exact: true }).waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });
		assert.equal(await plan.locator("progress").getAttribute("value"), "2");
		assert.equal(await plan.locator(".workbench-plan-step.completed").count(), 2);
		assert.equal(await plan.locator(".workbench-plan-step.in_progress").count(), 1);
		assert.equal(await studio.page.getByText(UPDATED_REPLY, { exact: true }).count(), 0, "plan should update before the final reply");

		await studio.page.getByText(UPDATED_REPLY, { exact: true }).waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });
		assert.equal(studio.server.requests.length, 4);
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
