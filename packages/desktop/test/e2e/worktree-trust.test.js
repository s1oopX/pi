/**
 * End-to-end worktree trust inheritance: trusting a repository once covers
 * the worktrees the app creates for its parallel tasks — the task starts with
 * no trust banner and the project extension runs immediately in the worktree.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { assertPrerequisites, launchStudio, LAUNCH_TIMEOUT_MS } from "./harness.mjs";

const MARK_EXTENSION = `import { writeFileSync } from "node:fs";
import { join } from "node:path";
export default function () {
  writeFileSync(join(process.cwd(), ".pi", "loaded.marker"), "loaded");
}
`;

function git(cwd, args) {
	execFileSync("git", args, {
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
	});
}

test("worktree trust: a trusted repo's worktree task starts trusted", async (t) => {
	assertPrerequisites();

	const studio = await launchStudio({
		reply: "ok",
		setupWorkspace: (workspaceDir) => {
			git(workspaceDir, ["init", "-b", "main"]);
			const extDir = join(workspaceDir, ".pi", "extensions");
			mkdirSync(extDir, { recursive: true });
			writeFileSync(join(extDir, "mark.js"), MARK_EXTENSION);
			git(workspaceDir, ["add", "-A"]);
			git(workspaceDir, ["commit", "-m", "initial with extension"]);
		},
	});
	t.after(() => studio.close());

	const worktreePath = join(studio.tempRoot, "user-data", "worktrees", "workspace-1");

	try {
		await studio.waitUntilReady();

		// The primary starts untrusted; trust it once through the banner.
		const banner = studio.page.locator(".trust-banner");
		await banner.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await studio.page.locator(".trust-banner-btn").click();
		await banner.waitFor({ state: "hidden", timeout: LAUNCH_TIMEOUT_MS });

		// A parallel task in the same repository runs in a fresh worktree path;
		// trust must follow the repository identity.
		await studio.stubFolderPicker(studio.workspaceDir);
		await studio.page.locator(".parallel-tasks .workspace-navigation-add").click();
		await studio.page
			.locator(".parallel-task-row.active .parallel-task-dot.ready")
			.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await studio.waitForWorkspaceSettled();

		// Trusted from the start: the extension already ran inside the worktree.
		let ran = false;
		for (let attempt = 0; attempt < 40 && !ran; attempt++) {
			ran = existsSync(join(worktreePath, ".pi", "loaded.marker"));
			if (!ran) await studio.page.waitForTimeout(500);
		}
		assert.equal(ran, true, "the project extension should run in the trusted worktree");
		assert.equal(
			await banner.count(),
			0,
			"a worktree of a trusted repository must not show the trust banner",
		);
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
