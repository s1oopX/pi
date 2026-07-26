/**
 * End-to-end tool loop: the faux provider returns a bash tool call, the real
 * backend executes it in the isolated workspace, and the renderer must show
 * the running tool card with a LIVE output tail (tool_execution_update)
 * before the final assistant reply lands.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { assertPrerequisites, launchStudio, LAUNCH_TIMEOUT_MS, REPLY_TIMEOUT_MS } from "./harness.mjs";

const TOOL_COMMAND = "echo live-chunk-1; sleep 2; echo live-chunk-2";
const FINAL_REPLY = "Tool loop complete.";

test("tool loop: live output streams while the bash tool runs", async (t) => {
	assertPrerequisites();

	const studio = await launchStudio({
		script: [
			{ toolCalls: [{ id: "call_1", name: "bash", arguments: { command: TOOL_COMMAND } }] },
			{ reply: FINAL_REPLY },
		],
	});
	t.after(() => studio.close());

	try {
		await studio.waitUntilReady();
		await studio.sendPrompt("Run the demo command");

		// The tool card must go live before the run finishes, and the live tail
		// must show the first chunk while the sleep still holds the tool open.
		const liveOutput = studio.page.locator(".tool-live-output");
		await liveOutput.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		const liveText = await liveOutput.textContent();
		assert.ok(liveText?.includes("live-chunk-1"), `live output missing first chunk: ${JSON.stringify(liveText)}`);
		const runningCard = await studio.page.locator(".tool-call-part.status-running").count();
		assert.ok(runningCard > 0, "expected a running tool card while output streams");

		await studio.page.getByText(FINAL_REPLY).first().waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });
		await studio.page
			.locator(".tool-call-part.status-done")
			.first()
			.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });

		assert.equal(studio.server.requests.length, 2, "faux provider should see the prompt and the tool follow-up");
		const followUp = studio.server.requests[1].body;
		const toolMessages = (followUp?.messages ?? []).filter((message) => message.role === "tool");
		assert.ok(toolMessages.length > 0, "tool result did not reach the faux provider");
		assert.ok(
			JSON.stringify(toolMessages).includes("live-chunk-2"),
			"tool result content missing the command output",
		);
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
