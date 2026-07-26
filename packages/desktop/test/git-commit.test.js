import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	commitAllChanges,
	getFileDiff,
	restoreFileChanges,
	listGitBranches,
	listGitChanges,
	parseGitPorcelainChanges,
	pushCurrentBranch,
	switchGitBranch,
	validateBranchName,
	validateCommitMessage,
} from "../src/git-commit.js";

const fsOk = {
	realpathImpl: async (path) => path,
	statImpl: async () => ({ isDirectory: () => true }),
};

function fakeGit(responses) {
	const calls = [];
	const execFileImpl = (_cmd, args, _options, callback) => {
		calls.push(args);
		const response = responses.shift() ?? { stdout: "" };
		callback(response.error ?? null, response.stdout ?? "", response.stderr ?? "");
	};
	return { calls, execFileImpl };
}

describe("parseGitPorcelainChanges", () => {
	it("parses statuses, renames, and untracked entries", () => {
		const { files, truncated } = parseGitPorcelainChanges(
			" M src/a.ts\nA  src/new.ts\nR  old.ts -> new-name.ts\n?? notes.md\n",
		);
		assert.deepEqual(files, [
			{ status: "M", path: "src/a.ts" },
			{ status: "A", path: "src/new.ts" },
			{ status: "R", path: "new-name.ts" },
			{ status: "??", path: "notes.md" },
		]);
		assert.equal(truncated, false);
	});

	it("caps the listing and reports truncation", () => {
		const output = Array.from({ length: 205 }, (_, index) => ` M file-${index}.ts`).join("\n");
		const { files, truncated } = parseGitPorcelainChanges(output);
		assert.equal(files.length, 200);
		assert.equal(truncated, true);
	});
});

describe("validateCommitMessage", () => {
	it("requires a non-empty message and trims it", () => {
		assert.equal(validateCommitMessage("  ").ok, false);
		assert.deepEqual(validateCommitMessage("  fix: thing  "), { ok: true, message: "fix: thing" });
		assert.equal(validateCommitMessage("x".repeat(5001)).ok, false);
	});
});

describe("listGitChanges", () => {
	it("runs a no-shell porcelain status in the workspace", async () => {
		const git = fakeGit([{ stdout: " M src/a.ts\n" }]);
		const result = await listGitChanges("C:\\work", { ...fsOk, execFileImpl: git.execFileImpl });
		assert.deepEqual(result.files, [{ status: "M", path: "src/a.ts" }]);
		assert.ok(git.calls[0].includes("--porcelain"));
	});

	it("surfaces git failures with the stderr detail", async () => {
		const git = fakeGit([{ error: new Error("exit 128"), stderr: "fatal: not a git repository" }]);
		await assert.rejects(
			listGitChanges("C:\\work", { ...fsOk, execFileImpl: git.execFileImpl }),
			/not a git repository/,
		);
	});
});

describe("commitAllChanges", () => {
	it("stages everything then commits with the message as a single argument", async () => {
		const git = fakeGit([{ stdout: "" }, { stdout: "[main abc123] fix: thing\n 1 file changed\n" }]);
		const result = await commitAllChanges("C:\\work", "fix: thing", { ...fsOk, execFileImpl: git.execFileImpl });
		assert.deepEqual(result, { committed: true, summary: "[main abc123] fix: thing" });
		assert.deepEqual(git.calls[0].slice(-2), ["add", "--all"]);
		assert.deepEqual(git.calls[1].slice(-3), ["commit", "-m", "fix: thing"]);
	});

	it("maps an empty commit to a friendly error", async () => {
		const git = fakeGit([
			{ stdout: "" },
			{ error: new Error("exit 1"), stdout: "nothing to commit, working tree clean" },
		]);
		await assert.rejects(
			commitAllChanges("C:\\work", "fix: thing", { ...fsOk, execFileImpl: git.execFileImpl }),
			/Nothing to commit/,
		);
	});

	it("rejects an empty message before touching git", async () => {
		const git = fakeGit([]);
		await assert.rejects(commitAllChanges("C:\\work", "   ", { ...fsOk, execFileImpl: git.execFileImpl }), /required/);
		assert.equal(git.calls.length, 0);
	});
});

describe("validateBranchName", () => {
	it("accepts ordinary names and trims", () => {
		assert.deepEqual(validateBranchName("  feature/x  "), { ok: true, name: "feature/x" });
	});

	it("rejects flag-like, spaced, and malformed names", () => {
		for (const bad of ["", "   ", "-rf", "has space", "a..b", "a~b", "a:b", "/leading", "trailing/", "x.lock", "a@{b"]) {
			assert.equal(validateBranchName(bad).ok, false, bad);
		}
	});
});

describe("listGitBranches", () => {
	it("parses the current-branch marker and names", async () => {
		// git for-each-ref %(HEAD) emits "*" for the current branch, " " otherwise.
		const git = fakeGit([{ stdout: "*main\n feature/x\n bugfix\n" }]);
		const result = await listGitBranches("C:\\work", { ...fsOk, execFileImpl: git.execFileImpl });
		assert.equal(result.current, "main");
		assert.deepEqual(result.branches, [
			{ name: "main", current: true },
			{ name: "feature/x", current: false },
			{ name: "bugfix", current: false },
		]);
		assert.ok(git.calls[0].includes("for-each-ref"));
	});
});

describe("pushCurrentBranch", () => {
	it("plain-pushes when an upstream exists", async () => {
		const git = fakeGit([
			{ stdout: "main\n" }, // symbolic-ref HEAD
			{ stdout: "origin/main\n" }, // @{upstream}
			{ stderr: "To github.com:me/repo.git\n   abc..def  main -> main\n" },
		]);
		const result = await pushCurrentBranch("C:\\work", { ...fsOk, execFileImpl: git.execFileImpl });
		assert.equal(result.setUpstream, false);
		assert.deepEqual(git.calls[2].slice(-1), ["push"]);
	});

	it("sets upstream on first push of a new branch", async () => {
		const git = fakeGit([
			{ stdout: "feature/x\n" },
			{ error: new Error("no upstream"), stderr: "fatal: no upstream configured" },
			{ stderr: "Branch 'feature/x' set up to track 'origin/feature/x'.\n" },
		]);
		const result = await pushCurrentBranch("C:\\work", { ...fsOk, execFileImpl: git.execFileImpl });
		assert.equal(result.setUpstream, true);
		assert.deepEqual(git.calls[2], ["-c", "color.status=false", "-c", "core.quotepath=false", "push", "--set-upstream", "origin", "feature/x"]);
	});

	it("refuses a detached HEAD", async () => {
		const git = fakeGit([{ error: new Error("detached"), stderr: "" }]);
		await assert.rejects(pushCurrentBranch("C:\\work", { ...fsOk, execFileImpl: git.execFileImpl }), /detached HEAD/);
	});
});

describe("switchGitBranch", () => {
	it("switches to an existing branch (name validated, so no -- needed)", async () => {
		const git = fakeGit([{ stdout: "" }]);
		const result = await switchGitBranch("C:\\work", "feature/x", { ...fsOk, execFileImpl: git.execFileImpl });
		assert.deepEqual(result, { switched: true, branch: "feature/x", created: false });
		assert.deepEqual(git.calls[0].slice(-2), ["switch", "feature/x"]);
	});

	it("creates a branch with --create", async () => {
		const git = fakeGit([{ stdout: "" }]);
		await switchGitBranch("C:\\work", "new-thing", { create: true, ...fsOk, execFileImpl: git.execFileImpl });
		assert.deepEqual(git.calls[0].slice(-3), ["switch", "--create", "new-thing"]);
	});

	it("maps common failures to friendly errors", async () => {
		const dirty = fakeGit([{ error: new Error("x"), stderr: "error: Your local changes would be overwritten by checkout" }]);
		await assert.rejects(switchGitBranch("C:\\work", "other", { ...fsOk, execFileImpl: dirty.execFileImpl }), /Commit or stash/);

		const missing = fakeGit([{ error: new Error("x"), stderr: "fatal: invalid reference: nope" }]);
		await assert.rejects(switchGitBranch("C:\\work", "nope", { ...fsOk, execFileImpl: missing.execFileImpl }), /not found/);

		const exists = fakeGit([{ error: new Error("x"), stderr: "fatal: a branch named 'dup' already exists" }]);
		await assert.rejects(
			switchGitBranch("C:\\work", "dup", { create: true, ...fsOk, execFileImpl: exists.execFileImpl }),
			/already exists/,
		);
	});

	it("rejects an invalid branch name before touching git", async () => {
		const git = fakeGit([]);
		await assert.rejects(switchGitBranch("C:\\work", "-rf", { ...fsOk, execFileImpl: git.execFileImpl }), /start with/);
		assert.equal(git.calls.length, 0);
	});
});

describe("getFileDiff", () => {
	it("returns the HEAD diff for a tracked file", async () => {
		const git = fakeGit([{ stdout: "diff --git a/x b/x\n+new\n" }]);
		const result = await getFileDiff("C:\\work", "src/x.ts", { ...fsOk, execFileImpl: git.execFileImpl });
		assert.equal(result.patch.includes("+new"), true);
		assert.deepEqual(git.calls[0].slice(-4), ["diff", "HEAD", "--", "src/x.ts"]);
	});

	it("falls back to a no-index diff for an untracked file", async () => {
		const git = fakeGit([
			{ stdout: "" },
			{ error: new Error("exit 1"), stdout: "diff --git a/dev/null b/n.txt\n+hello\n" },
		]);
		const result = await getFileDiff("C:\\work", "n.txt", { ...fsOk, execFileImpl: git.execFileImpl });
		assert.equal(result.patch.includes("+hello"), true);
		assert.equal(git.calls[1].includes("--no-index"), true);
	});

	it("rejects empty paths", async () => {
		await assert.rejects(getFileDiff("C:\\work", " ", { ...fsOk, execFileImpl: fakeGit([]).execFileImpl }), /path/iu);
	});
});

describe("restoreFileChanges", () => {
	it("fully restores a file that exists in HEAD", async () => {
		const git = fakeGit([
			{ stdout: "100644 blob abc\tsrc/x.ts\n" },
			{ stdout: "" },
		]);
		const result = await restoreFileChanges("C:\\work", "src/x.ts", { ...fsOk, execFileImpl: git.execFileImpl });
		assert.deepEqual(result, { restored: true, untracked: false });
		assert.deepEqual(git.calls[1].slice(-6), ["restore", "--worktree", "--staged", "--source=HEAD", "--", "src/x.ts"]);
	});

	it("unstages a newly added file and reports it untracked for the caller to trash", async () => {
		const git = fakeGit([
			{ stdout: "" },
			{ stdout: "src/new.ts\n" },
			{ stdout: "" },
		]);
		const result = await restoreFileChanges("C:\\work", "src/new.ts", { ...fsOk, execFileImpl: git.execFileImpl });
		assert.deepEqual(result, { restored: false, untracked: true });
		assert.deepEqual(git.calls[2].slice(-4), ["restore", "--staged", "--", "src/new.ts"]);
	});

	it("reports a plain untracked file without touching git state", async () => {
		const git = fakeGit([
			{ stdout: "" },
			{ error: new Error("exit 1") },
		]);
		const result = await restoreFileChanges("C:\\work", "notes.txt", { ...fsOk, execFileImpl: git.execFileImpl });
		assert.deepEqual(result, { restored: false, untracked: true });
		assert.equal(git.calls.length, 2);
	});
});
