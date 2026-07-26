import assert from "node:assert/strict";
import { join, sep } from "node:path";
import { describe, it } from "node:test";
import {
	deriveWorktreeSourceRoot,
	directoriesShareIdentity,
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

	it("handles forward slashes everywhere and backslashes on Windows", () => {
		// git writes forward slashes even on Windows; normalize() folds them
		// into the host separator there and they are already native on posix.
		if (process.platform === "win32") {
			assert.equal(deriveWorktreeSourceRoot("D:/repos/my-app/.git/worktrees/wt-1"), "D:\\repos\\my-app");
			assert.equal(deriveWorktreeSourceRoot("D:\\repos\\my-app\\.git\\worktrees\\wt-1"), "D:\\repos\\my-app");
		} else {
			assert.equal(deriveWorktreeSourceRoot("/repos/my-app/.git/worktrees/wt-1"), "/repos/my-app");
		}
	});

	it("keeps a relative gitdir relative for the caller to resolve", () => {
		const relative = ["..", "..", "repo", ".git", "worktrees", "wt-1"].join(sep);
		assert.equal(deriveWorktreeSourceRoot(relative), ["..", "..", "repo"].join(sep));
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

describe("directoriesShareIdentity", () => {
	it("compares by device and inode, not by string", () => {
		const stats = { "spelling-a": { dev: 5n, ino: 77n }, "spelling-b": { dev: 5n, ino: 77n }, other: { dev: 5n, ino: 78n } };
		const statImpl = (path) => {
			const found = stats[path];
			if (!found) throw new Error("ENOENT");
			return found;
		};
		assert.equal(directoriesShareIdentity("spelling-a", "spelling-b", statImpl), true);
		assert.equal(directoriesShareIdentity("spelling-a", "other", statImpl), false);
		assert.equal(directoriesShareIdentity("spelling-a", "missing", statImpl), false);
	});

	it("treats a zero inode as unknown identity, never a match", () => {
		const statImpl = () => ({ dev: 1n, ino: 0n });
		assert.equal(directoriesShareIdentity("a", "b", statImpl), false);
	});

	it("matches a real directory against a differently-spelled path to itself", () => {
		const here = process.cwd();
		const differentSpelling = process.platform === "win32" ? here.toUpperCase() : `${here}${sep}.`;
		assert.equal(directoriesShareIdentity(here, differentSpelling), true);
	});
});
