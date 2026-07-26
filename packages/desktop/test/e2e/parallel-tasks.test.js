/**
 * End-to-end parallel tasks (M2 definition of done): a second backend runs in
 * another folder, both stream at once, switching mid-stream loses nothing,
 * background completion surfaces an unread badge, and stopping a task leaves
 * the primary untouched.
 *
 * Both backends share one faux provider, so the script uses content-matched
 * steps (`when`) instead of positional order.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { assertPrerequisites, launchStudio, LAUNCH_TIMEOUT_MS, REPLY_TIMEOUT_MS } from "./harness.mjs";

test("parallel tasks: two backends stream side by side and switching loses nothing", async (t) => {
	assertPrerequisites();

	const studio = await launchStudio({
		extraWorkspaces: 1,
		script: [
			{ when: "SLOW_TASK", reply: "slow reply done", delayMs: 10000 },
			{ when: "FAST_MAIN", reply: "fast reply done" },
			{ reply: "fallback" },
		],
	});
	t.after(() => studio.close());

	try {
		await studio.waitUntilReady();

		// Start a pool task in the second workspace; the folder picker is
		// stubbed at the Electron dialog layer.
		await studio.stubFolderPicker(studio.extraWorkspaceDirs[0]);
		await studio.page.locator(".parallel-tasks .workspace-navigation-add").click();

		// Creation auto-switches: the pool row becomes active and its backend
		// boots to ready.
		const activeRow = studio.page.locator(".parallel-task-row.active");
		await activeRow.locator(".parallel-task-label").filter({ hasText: "workspace-extra-1" }).first()
			.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await studio.page
			.locator(".parallel-task-row.active .parallel-task-dot.ready")
			.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await studio.waitForWorkspaceSettled();

		// Kick off the slow run in the pool task; its dot flips to streaming.
		await studio.sendPrompt("please run SLOW_TASK");
		await studio.page
			.locator(".parallel-task-row.active .parallel-task-dot.streaming")
			.waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });

		// Switch to the primary mid-stream; the pool task keeps streaming in
		// the background.
		await studio.page.locator(".parallel-task-main").first().click();
		const poolRow = studio.page.locator(".parallel-task-row").nth(1);
		await poolRow.locator(".parallel-task-dot.streaming").waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await studio.waitForWorkspaceSettled();

		// The primary answers its own prompt while the pool task still runs.
		await studio.sendPrompt("please run FAST_MAIN");
		await studio.page.getByText("fast reply done").first().waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });

		// Background completion: the pool row gains an unread badge.
		await poolRow.locator(".parallel-task-unread").waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });

		// Switching back rehydrates the pool conversation from its backend -
		// the full slow reply is there and the badge clears.
		await poolRow.locator(".parallel-task-main").click();
		await studio.page.getByText("slow reply done").first().waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });
		assert.equal(await studio.page.locator(".parallel-task-unread").count(), 0);

		// Stop the pool task (it is active, so the UI falls back to the
		// primary first); the row disappears and the primary still answers.
		await poolRow.locator(".parallel-task-stop").click();
		await studio.page
			.locator(".parallel-task-row")
			.nth(1)
			.waitFor({ state: "detached", timeout: LAUNCH_TIMEOUT_MS });
		assert.equal(await studio.page.locator(".parallel-task-row").count(), 1);
		await studio.page.getByText("fast reply done").first().waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
	} catch (error) {
		try {
			console.error("--- parallel-tasks section HTML ---");
			console.error(await studio.page.locator(".parallel-tasks").evaluate((node) => node.outerHTML));
		} catch {
			// section not rendered
		}
		await studio.dumpDiagnostics();
		throw error;
	}
});
