/**
 * End-to-end leftover-worktree management: stopping a task whose worktree has
 * uncommitted changes keeps the worktree; Settings → Agent lists it and the
 * armed delete removes it (branch survives).
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { assertPrerequisites, launchStudio, LAUNCH_TIMEOUT_MS } from "./harness.mjs";

function git(cwd, args) {
	return execFileSync("git", args, {
		cwd,
		stdio: "pipe",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "E2E",
			GIT_AUTHOR_EMAIL: "e2e@example.com",
			GIT_COMMITTER_NAME: "E2E",
			GIT_COMMITTER_EMAIL: "e2e@example.com",
			GIT_CONFIG_GLOBAL: "",
			GIT_CONFIG_SYSTEM: "",
		},
	})
		.toString()
		.trim();
}

test("worktree leftovers: a dirty worktree survives the stop and is deletable from Settings", async (t) => {
	assertPrerequisites();

	const studio = await launchStudio({
		reply: "ok",
		setupWorkspace: (workspaceDir) => {
			git(workspaceDir, ["init", "-b", "main"]);
			writeFileSync(join(workspaceDir, "README.md"), "# leftovers e2e\n");
			git(workspaceDir, ["add", "README.md"]);
			git(workspaceDir, ["commit", "-m", "initial"]);
		},
	});
	t.after(() => studio.close());

	const worktreePath = join(studio.tempRoot, "user-data", "worktrees", "workspace-1");

	try {
		await studio.waitUntilReady();

		await studio.stubFolderPicker(studio.workspaceDir);
		await studio.page.locator(".parallel-tasks .workspace-navigation-add").click();
		await studio.page
			.locator(".parallel-task-row.active .parallel-task-branch")
			.filter({ hasText: "task/workspace-1" })
			.first()
			.waitFor({ state: "attached", timeout: LAUNCH_TIMEOUT_MS });
		await studio.page
			.locator(".parallel-task-row.active .parallel-task-dot.ready")
			.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await studio.waitForWorkspaceSettled();

		// Make the worktree dirty, then stop the task: the worktree is kept.
		writeFileSync(join(worktreePath, "wip.txt"), "uncommitted work\n");
		await studio.page.locator(".parallel-task-stop").click();
		await studio.page
			.locator(".parallel-task-row")
			.nth(1)
			.waitFor({ state: "detached", timeout: LAUNCH_TIMEOUT_MS });
		assert.equal(existsSync(join(worktreePath, "wip.txt")), true, "a dirty worktree must be kept on stop");

		// Settings -> Agent lists the leftover; the armed two-click delete
		// discards it while the task branch stays.
		await studio.page.locator(".sidebar-footer .sidebar-action-btn").click();
		await studio.page.locator('.settings-nav-item[data-route="agent-general"]').click();
		const row = studio.page.locator(".worktree-leftover-row");
		await row.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await row.locator(".worktree-leftover-dirty").waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await row.locator(".worktree-leftover-delete").click(); // arm
		await row.locator(".worktree-leftover-delete").click(); // confirm
		await row.waitFor({ state: "detached", timeout: LAUNCH_TIMEOUT_MS });

		let gone = false;
		for (let attempt = 0; attempt < 40 && !gone; attempt++) {
			gone = !existsSync(worktreePath);
			if (!gone) await studio.page.waitForTimeout(500);
		}
		assert.equal(gone, true, "the deleted worktree directory should be removed");
		assert.equal(git(studio.workspaceDir, ["branch", "--list", "task/workspace-1"]).length > 0, true);
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
