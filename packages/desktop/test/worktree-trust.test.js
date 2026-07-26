import assert from "node:assert/strict";
import { join, sep } from "node:path";
import { describe, it } from "node:test";
import {
	deriveWorktreeSourceRoot,
	parseWorktreeGitdir,
	resolveWorktreeSourceRoot,
} from "../src/worktree-trust.js";

// Platform-native fixtures: these run on Windows locally and Linux in CI.
const repoRoot = join("repos", "my-app");
const worktreeGitdir = join(repoRoot, ".git", "worktrees", "my-app-1");
const worktreeCwd = join("data", "worktrees", "my-app-1");

describe("parseWorktreeGitdir", () => {
	it("extracts the gitdir path from a worktree .git file", () => {
		assert.equal(parseWorktreeGitdir(`gitdir: ${worktreeGitdir}\n`), worktreeGitdir);
		assert.equal(parseWorktreeGitdir(`gitdir:${worktreeGitdir}`), worktreeGitdir);
	});

	it("rejects non-worktree content", () => {
		assert.equal(parseWorktreeGitdir("ref: refs/heads/main\n"), null);
		assert.equal(parseWorktreeGitdir(""), null);
	});
});

describe("deriveWorktreeSourceRoot", () => {
	it("maps <root>/.git/worktrees/<name> to the repository root", () => {
		assert.equal(deriveWorktreeSourceRoot(worktreeGitdir), repoRoot);
	});

	it("returns null for gitdirs that are not linked worktrees", () => {
		assert.equal(deriveWorktreeSourceRoot(join(repoRoot, ".git")), null);
		assert.equal(deriveWorktreeSourceRoot(join("elsewhere", "worktrees", "x")), null);
	});

	it("handles both separators regardless of host platform", () => {
		assert.equal(
			deriveWorktreeSourceRoot("D:/repos/my-app/.git/worktrees/wt-1"),
			["D:", "repos", "my-app"].join(sep),
		);
		assert.equal(
			deriveWorktreeSourceRoot("D:\\repos\\my-app\\.git\\worktrees\\wt-1"),
			["D:", "repos", "my-app"].join(sep),
		);
	});
});

describe("resolveWorktreeSourceRoot", () => {
	it("reads the .git file and resolves the source repository", () => {
		const readImpl = (path) => {
			assert.equal(path, join(worktreeCwd, ".git"));
			return `gitdir: ${worktreeGitdir}\n`;
		};
		assert.equal(resolveWorktreeSourceRoot(worktreeCwd, readImpl), repoRoot);
	});

	it("returns null when .git is a directory or unreadable (a normal checkout)", () => {
		assert.equal(
			resolveWorktreeSourceRoot(worktreeCwd, () => {
				throw new Error("EISDIR");
			}),
			null,
		);
	});
});
