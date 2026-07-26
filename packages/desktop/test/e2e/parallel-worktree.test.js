/**
 * End-to-end same-repo worktree isolation (M3): creating a parallel task for
 * the folder that is already running provisions a git worktree on a fresh
 * task/<name> branch, the git panel follows the active task into the
 * worktree, the primary checkout stays untouched, and stopping the task
 * removes the clean worktree while keeping the branch.
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

test("worktree isolation: a second task in the same repo runs on its own branch", async (t) => {
	assertPrerequisites();

	const studio = await launchStudio({
		reply: "ok",
		setupWorkspace: (workspaceDir) => {
			git(workspaceDir, ["init", "-b", "main"]);
			writeFileSync(join(workspaceDir, "README.md"), "# worktree e2e\n");
			git(workspaceDir, ["add", "README.md"]);
			git(workspaceDir, ["commit", "-m", "initial"]);
		},
	});
	t.after(() => studio.close());

	const worktreePath = join(studio.tempRoot, "user-data", "worktrees", "workspace-1");

	try {
		await studio.waitUntilReady();

		// Pick the folder that is already running as the primary workspace.
		await studio.stubFolderPicker(studio.workspaceDir);
		await studio.page.locator(".parallel-tasks .workspace-navigation-add").click();

		// The task comes up in a worktree, labeled with its branch.
		const activeRow = studio.page.locator(".parallel-task-row.active");
		await activeRow.locator(".parallel-task-branch").filter({ hasText: "task/workspace-1" }).first()
			.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await studio.page
			.locator(".parallel-task-row.active .parallel-task-dot.ready")
			.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await studio.waitForWorkspaceSettled();

		assert.equal(existsSync(join(worktreePath, "README.md")), true, "the worktree checkout should exist");
		assert.equal(
			git(studio.workspaceDir, ["branch", "--list", "task/workspace-1"]).length > 0,
			true,
			"the task branch should exist in the source repo",
		);
		// The primary checkout never moved off its branch and stayed clean.
		assert.equal(git(studio.workspaceDir, ["branch", "--show-current"]), "main");
		assert.equal(git(studio.workspaceDir, ["status", "--porcelain"]), "");

		// The git panel follows the active task into the worktree.
		await studio.page.locator(".top-bar-git").click();
		await studio.page
			.locator(".git-panel-branch-name")
			.filter({ hasText: "task/workspace-1" })
			.first()
			.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await studio.page.locator(".git-panel-cancel").click();

		// Stopping the active worktree task falls back to the primary, removes
		// the clean worktree, and keeps the branch for later landing.
		await studio.page.locator(".parallel-task-stop").click();
		await studio.page
			.locator(".parallel-task-row")
			.nth(1)
			.waitFor({ state: "detached", timeout: LAUNCH_TIMEOUT_MS });
		let gone = false;
		for (let attempt = 0; attempt < 40 && !gone; attempt++) {
			gone = !existsSync(worktreePath);
			if (!gone) await studio.page.waitForTimeout(500);
		}
		assert.equal(gone, true, "a clean worktree should be removed on stop");
		assert.equal(git(studio.workspaceDir, ["branch", "--list", "task/workspace-1"]).length > 0, true);
		assert.equal(git(studio.workspaceDir, ["branch", "--show-current"]), "main");
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
