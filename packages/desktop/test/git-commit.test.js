import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commitAllChanges, listGitChanges, parseGitPorcelainChanges, validateCommitMessage } from "../src/git-commit.js";

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
