import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
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

test("PR review feedback loads, updates, and drafts an agent handoff", async (t) => {
	assertPrerequisites();

	const studio = await launchStudio({
		reply: "ok",
		setupWorkspace(workspaceDir) {
			git(workspaceDir, ["init", "-b", "main"]);
			writeFileSync(join(workspaceDir, "README.md"), "# e2e\n");
			git(workspaceDir, ["add", "README.md"]);
			git(workspaceDir, ["commit", "-m", "initial"]);
			git(workspaceDir, ["switch", "-c", "feature/pr-review"]);
			git(workspaceDir, ["remote", "add", "origin", "https://github.com/e2e-org/e2e-repo.git"]);
		},
	});
	t.after(() => studio.close());

	try {
		await studio.waitUntilReady();
		await studio.app.evaluate(({ ipcMain }) => {
			globalThis.__piPrReviewActions = [];
			globalThis.__piPrReview = {
				number: 17,
				title: "Improve retry handling",
				url: "https://github.com/e2e-org/e2e-repo/pull/17",
				state: "OPEN",
				reviewDecision: "CHANGES_REQUESTED",
				partial: false,
				feedback: [{
					kind: "inline",
					id: "101",
					author: "reviewer",
					body: "Please cover the retry branch.",
					createdAt: "2026-07-29T03:00:00Z",
					url: "https://github.com/e2e-org/e2e-repo/pull/17#discussion_r101",
					path: "src/app.ts",
					line: 42,
					side: "RIGHT",
					threadId: "PRRT_e2e",
					resolved: false,
					outdated: true,
					canReply: true,
					canResolve: true,
					canUnresolve: false,
				}],
			};
			ipcMain.removeHandler("git:pr-context");
			ipcMain.handle("git:pr-context", () => ({
				branch: "feature/pr-review",
				detached: false,
				baseBranch: "main",
				remote: { host: "github.com", owner: "e2e-org", repo: "e2e-repo" },
				isGitHub: true,
				compareUrl: "https://github.com/e2e-org/e2e-repo/compare/main...feature%2Fpr-review?expand=1",
				lastCommitSubject: "initial",
				hasUpstream: true,
				ghAvailable: true,
			}));
			ipcMain.removeHandler("git:pr-review");
			ipcMain.handle("git:pr-review", () => globalThis.__piPrReview);
			ipcMain.removeHandler("git:pr-review-action");
			ipcMain.handle("git:pr-review-action", (_event, action) => {
				globalThis.__piPrReviewActions.push(action);
				if (action.type === "resolve") {
					globalThis.__piPrReview.feedback[0] = {
						...globalThis.__piPrReview.feedback[0],
						resolved: action.resolved,
						canResolve: !action.resolved,
						canUnresolve: action.resolved,
					};
				}
				return { updated: true };
			});
		});
		await studio.page.locator(".top-bar-git").click();
		await studio.page.locator(".git-panel-pr-toggle").click();
		const loadReview = studio.page.locator(".git-panel-pr-review-load");
		await loadReview.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await loadReview.click();

		const feedback = studio.page.locator(".git-panel-line-comment").filter({ hasText: "Please cover the retry branch." });
		await feedback.getByText("Please cover the retry branch.", { exact: true }).waitFor({
			state: "visible",
			timeout: LAUNCH_TIMEOUT_MS,
		});
		assert.match(
			(await feedback.locator(".git-panel-line-comment-meta").textContent()) ?? "",
			/reviewer.*src\/app\.ts:42.*(?:Open|未解决).*(?:Outdated|已过时)/su,
		);

		const prComment = studio.page.locator(".git-panel-pr-comment textarea");
		await prComment.fill("Ship it after the retry fix.");
		await studio.page.locator('.git-panel-pr-comment button[type="submit"]').click();
		await studio.page.waitForFunction(() => {
			const input = document.querySelector(".git-panel-pr-comment textarea");
			return input instanceof HTMLTextAreaElement && input.value === "";
		});

		await feedback.locator(".git-panel-pr-reply-toggle").click();
		const reply = feedback.locator(".git-panel-pr-reply textarea");
		await reply.fill("Fixed in the latest commit.");
		await feedback.locator('.git-panel-pr-reply button[type="submit"]').click();
		await reply.waitFor({ state: "detached", timeout: LAUNCH_TIMEOUT_MS });

		await feedback.locator(".git-panel-pr-resolve").click();
		await feedback.locator(".git-panel-pr-reopen").waitFor({
			state: "visible",
			timeout: LAUNCH_TIMEOUT_MS,
		});
		assert.deepEqual(await studio.app.evaluate(() => globalThis.__piPrReviewActions), [
			{ type: "comment", body: "Ship it after the retry fix." },
			{ type: "reply", threadId: "PRRT_e2e", body: "Fixed in the latest commit." },
			{ type: "resolve", threadId: "PRRT_e2e", resolved: true },
		]);

		await feedback.locator(".git-panel-pr-ask").click();
		const draft = await studio.page.locator(".composer-input").evaluate(
			(element) => /** @type {HTMLTextAreaElement} */ (element).value,
		);
		for (const expected of ["@src/app.ts", "42", "Please cover the retry branch.", "#17"]) {
			assert.ok(draft.includes(expected), `PR feedback draft should include ${expected}, got: ${draft}`);
		}
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
