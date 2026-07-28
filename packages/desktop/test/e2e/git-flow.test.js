/**
 * End-to-end git flow: open the top-bar git panel against a real repository,
 * create a branch, and push to a local bare remote. Exercises the git:changes,
 * git:branches, git:switch-branch, and git:push IPC wiring.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { assertPrerequisites, launchStudio, LAUNCH_TIMEOUT_MS } from "./harness.mjs";

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

test("git flow: create a branch and push to a bare remote", async (t) => {
	assertPrerequisites();

	let remoteDir;
	const studio = await launchStudio({
		reply: "ok",
		setupWorkspace: (workspaceDir, tempRoot) => {
			remoteDir = join(tempRoot, "remote.git");
			git(tempRoot, ["init", "--bare", "-b", "main", remoteDir]);
			git(workspaceDir, ["init", "-b", "main"]);
			git(workspaceDir, ["remote", "add", "origin", remoteDir]);
			writeFileSync(join(workspaceDir, "README.md"), "# e2e\n");
			git(workspaceDir, ["add", "README.md"]);
			git(workspaceDir, ["commit", "-m", "initial"]);
			// Leave an untracked file so the changes list is non-empty.
			writeFileSync(join(workspaceDir, "notes.txt"), "scratch\n");
		},
	});
	t.after(() => studio.close());

	try {
		await studio.waitUntilReady();

		// Open the git panel from the top-bar branch button.
		await studio.page.locator(".top-bar-git").click();
		const panel = studio.page.locator(".git-panel");
		await panel.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });

		// The untracked file appears in the changes list.
		await studio.page.getByText("notes.txt").first().waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });

		// Create a new branch.
		await studio.page.locator(".git-panel-branch-toggle").click();
		await studio.page.locator(".git-panel-new-branch-input").fill("feature/e2e");
		await studio.page.locator(".git-panel-new-branch-btn").click();

		// The branch label updates to the new branch.
		await studio.page
			.locator(".git-panel-branch-name")
			.filter({ hasText: "feature/e2e" })
			.first()
			.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		assert.equal(
			execFileSync("git", ["branch", "--show-current"], { cwd: studio.workspaceDir }).toString().trim(),
			"feature/e2e",
		);

		// Push the new branch; it has no upstream, so this sets one on the bare
		// remote. Assert the durable effect (the remote ref) rather than the
		// transient success toast.
		await studio.page.locator(".git-panel-push-btn").click();
		let remoteRef = "";
		for (let attempt = 0; attempt < 40 && !remoteRef; attempt++) {
			try {
				remoteRef = execFileSync("git", ["--git-dir", remoteDir, "rev-parse", "feature/e2e"], {
					stdio: ["ignore", "pipe", "ignore"],
				})
					.toString()
					.trim();
			} catch {
				await studio.page.waitForTimeout(500);
			}
		}
		assert.match(remoteRef, /^[0-9a-f]{40}$/u, "the bare remote should have received feature/e2e");

		// PR context: a filesystem remote is not GitHub, so the PR section only
		// shows an explanatory note (no head/base form).
		await studio.page.locator(".git-panel-pr-toggle").click();
		const prSection = studio.page.locator(".git-panel-pr");
		await prSection.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await prSection.locator(".git-panel-note").first().waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		assert.equal(await prSection.locator(".git-panel-pr-route").count(), 0);

		// With a GitHub-shaped origin the context resolves head -> base; the
		// upstream tracking from the earlier push persists across the URL change.
		git(studio.workspaceDir, ["remote", "set-url", "origin", "https://github.com/e2e-org/e2e-repo.git"]);
		await studio.page.locator(".git-panel-pr-toggle").click(); // close
		await studio.page.locator(".git-panel-pr-toggle").click(); // reopen -> refetch
		const prHead = studio.page.locator(".git-panel-pr-head");
		await prHead.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		assert.equal((await prHead.textContent())?.trim(), "feature/e2e");
		assert.equal(await studio.page.locator(".git-panel-pr-base-input").inputValue(), "main");

		// Per-file review: expanding a changed file shows its diff, and the
		// armed two-click discard recycles an untracked file off the disk.
		await studio.page.locator(".git-panel-file-path", { hasText: "notes.txt" }).first().click();
		const fileDiff = studio.page.locator(".git-panel-file-diff");
		await fileDiff.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await fileDiff.getByText("scratch").first().waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		// Line-anchored review: selecting the added line opens a comment form;
		// submitting drafts the exact file, side, line, comment, and diff text.
		const lineAnchor = fileDiff.locator('.diff-line-anchor[data-diff-side="new"][data-diff-line="1"]');
		await lineAnchor.focus();
		await lineAnchor.press("Enter");
		await studio.page.locator(".git-panel-line-comment textarea").fill("Keep this note durable.");
		await studio.page.locator('.git-panel-line-comment-actions button[type="submit"]').click();
		await studio.page
			.locator(".composer-input")
			.evaluate((el) => /** @type {HTMLTextAreaElement} */ (el).value)
			.then((value) => {
				for (const expected of ["@notes.txt", "1", "Keep this note durable.", "scratch"]) {
					assert.ok(value.includes(expected), `line comment draft should include ${expected}, got: ${value}`);
				}
			});
		await studio.page.locator(".top-bar-git").click();
		await studio.page.locator(".git-panel-file-path", { hasText: "notes.txt" }).first().click();
		await studio.page.locator(".git-panel-file-diff").waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		// "Ask agent" drafts an @file prompt into the composer and closes the
		// panel; reopen and re-expand for the discard flow below.
		await studio.page.locator(".git-panel-ask-btn").click();
		await studio.page
			.locator(".composer-input")
			.evaluate((el) => /** @type {HTMLTextAreaElement} */ (el).value)
			.then((value) => assert.ok(value.includes("@notes.txt"), `composer draft should reference the file, got: ${value}`));
		await studio.page.locator(".top-bar-git").click();
		await studio.page.locator(".git-panel-file-path", { hasText: "notes.txt" }).first().click();
		await studio.page.locator(".git-panel-file-diff").waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });

		const discard = studio.page.locator(".git-panel-restore-btn");
		await discard.click(); // arm
		await discard.click(); // confirm
		let removed = false;
		for (let attempt = 0; attempt < 40 && !removed; attempt++) {
			removed = !existsSync(join(studio.workspaceDir, "notes.txt"));
			if (!removed) await studio.page.waitForTimeout(500);
		}
		assert.equal(removed, true, "discarding an untracked file should recycle it off the disk");
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
