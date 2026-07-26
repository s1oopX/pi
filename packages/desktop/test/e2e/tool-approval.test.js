/**
 * End-to-end permission gate: with the bundled tool-approval extension and the
 * default "ask" mode, a bash tool call must raise a native inline approval
 * dialog. When the user denies it, the tool must be blocked and never run.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { assertPrerequisites, launchStudio, LAUNCH_TIMEOUT_MS, REPLY_TIMEOUT_MS } from "./harness.mjs";

// The command text never contains its own output (42), so a follow-up that
// mentions 42 would prove the command ran despite the denial.
const COMMAND = "echo $((6 * 7))";
const OUTPUT_IF_RUN = "42";
const FINAL_REPLY = "Understood, stopping.";

test("permission gate: denying a tool call blocks it end to end", async (t) => {
	assertPrerequisites();

	const studio = await launchStudio({
		script: [
			{ toolCalls: [{ id: "call_1", name: "bash", arguments: { command: COMMAND } }] },
			{ reply: FINAL_REPLY },
		],
	});
	t.after(() => studio.close());

	try {
		await studio.waitUntilReady();
		await studio.sendPrompt("Run the command");

		const approval = studio.page.locator(".inline-approval");
		await approval.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		const detail = await approval.textContent();
		assert.ok(detail?.includes(COMMAND), `approval dialog should show the command: ${JSON.stringify(detail)}`);

		await studio.page.locator(".inline-approval .dialog-btn-danger").click();

		await studio.page.getByText(FINAL_REPLY).first().waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });

		assert.equal(studio.server.requests.length, 2, "the run should continue after the block");
		const toolMessages = (studio.server.requests[1].body?.messages ?? []).filter((m) => m.role === "tool");
		const toolText = JSON.stringify(toolMessages);
		assert.ok(toolText.includes("not approved"), "blocked tool result should carry the denial reason");
		assert.ok(!toolText.includes(OUTPUT_IF_RUN), "the denied command must not have executed");
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
