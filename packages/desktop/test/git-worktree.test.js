import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import {
	createTaskWorktree,
	deleteLeftoverWorktree,
	isGitRepository,
	isPathInsideWorktreesRoot,
	listWorktreeLeftovers,
	pickWorktreeName,
	removeTaskWorktree,
} from "../src/git-worktree.js";

function fakeExec(responses) {
	const calls = [];
	const execFileImpl = (cmd, args, _options, callback) => {
		calls.push({ cmd, args });
		const response = responses.shift() ?? { stdout: "" };
		callback(response.error ?? null, response.stdout ?? "", response.stderr ?? "");
	};
	return { calls, execFileImpl };
}

const repoCwd = resolve("repos", "my-app");
const worktreesRoot = resolve("user-data", "worktrees");

it("keeps managed worktree paths below the worktrees root", () => {
	assert.equal(isPathInsideWorktreesRoot(worktreesRoot, join(worktreesRoot, "my-app-1")), true);
	assert.equal(isPathInsideWorktreesRoot(worktreesRoot, resolve(worktreesRoot, "..", "outside")), false);
});

function fsImpls({ existing = [] } = {}) {
	const made = [];
	return {
		made,
		mkdirImpl: async (path) => {
			made.push(path);
		},
		readdirImpl: async () => existing,
	};
}

describe("pickWorktreeName", () => {
	it("allocates the lowest free slot for the repo basename", () => {
		assert.equal(pickWorktreeName("my-app", []), "my-app-1");
		assert.equal(pickWorktreeName("my-app", ["my-app-1", "my-app-3", "other-1"]), "my-app-2");
	});

	it("sanitizes unusual folder names", () => {
		assert.equal(pickWorktreeName("My Repo!", []), "my-repo-1");
		assert.equal(pickWorktreeName("...", []), "repo-1");
	});
});

describe("isGitRepository", () => {
	it("reflects whether git resolves a git dir", async () => {
		const yes = fakeExec([{ stdout: ".git\n" }]);
		assert.equal(await isGitRepository(repoCwd, { execFileImpl: yes.execFileImpl }), true);
		const no = fakeExec([{ error: new Error("not a repo"), stderr: "fatal: not a git repository" }]);
		assert.equal(await isGitRepository(repoCwd, { execFileImpl: no.execFileImpl }), false);
	});
});

describe("createTaskWorktree", () => {
	it("prunes, probes the branch, and adds the worktree with a created branch", async () => {
		const exec = fakeExec([
			{ stdout: "" }, // worktree prune
			{ error: new Error("no ref") }, // rev-parse task/my-app-1 -> free
			{ stdout: "" }, // worktree add
		]);
		const fs = fsImpls();
		const result = await createTaskWorktree(repoCwd, worktreesRoot, {
			execFileImpl: exec.execFileImpl,
			...fs,
		});
		assert.equal(result.branch, "task/my-app-1");
		assert.equal(result.worktreePath, join(worktreesRoot, "my-app-1"));
		assert.deepEqual(fs.made, [worktreesRoot]);
		const gitArgs = exec.calls.map((call) => call.args.filter((arg) => !arg.startsWith("-c") && arg !== "color.status=false" && arg !== "core.quotepath=false"));
		assert.deepEqual(gitArgs[0], ["worktree", "prune"]);
		assert.deepEqual(gitArgs[2], ["worktree", "add", "-b", "task/my-app-1", join(worktreesRoot, "my-app-1")]);
	});

	it("bumps the branch name past existing task branches", async () => {
		const exec = fakeExec([
			{ stdout: "" }, // prune
			{ stdout: "abc123\n" }, // task/my-app-2 exists (dir slot 2 was free but branch remains)
			{ error: new Error("no ref") }, // task/my-app-2-2 free
			{ stdout: "" }, // add
		]);
		const fs = fsImpls({ existing: ["my-app-1"] });
		const result = await createTaskWorktree(repoCwd, worktreesRoot, {
			execFileImpl: exec.execFileImpl,
			...fs,
		});
		assert.equal(result.branch, "task/my-app-2-2");
		const addCall = exec.calls.at(-1);
		assert.ok(addCall.args.includes("task/my-app-2-2"));
	});

	it("surfaces add failures with the git detail", async () => {
		const exec = fakeExec([
			{ stdout: "" },
			{ error: new Error("no ref") },
			{ error: new Error("exit 128"), stderr: "fatal: could not create work tree dir" },
		]);
		await assert.rejects(
			createTaskWorktree(repoCwd, worktreesRoot, { execFileImpl: exec.execFileImpl, ...fsImpls() }),
			/could not create work tree/,
		);
	});
});

describe("listWorktreeLeftovers", () => {
	const wt = (name) => join(worktreesRoot, name);
	const gitFileFor = (name) => join(repoCwd, ".git", "worktrees", name);

	it("lists non-active worktree dirs with their source repo and dirty state", async () => {
		const exec = fakeExec([
			{ stdout: " M a.txt\n" }, // status for my-app-1 -> dirty
			{ stdout: "" }, // status for my-app-3 -> clean
		]);
		const result = await listWorktreeLeftovers(worktreesRoot, [wt("my-app-2")], {
			execFileImpl: exec.execFileImpl,
			readdirImpl: async () => ["my-app-1", "my-app-2", "my-app-3"],
			readFileImpl: (path) => `gitdir: ${gitFileFor(path.includes("my-app-1") ? "my-app-1" : "my-app-3")}\n`,
		});
		assert.deepEqual(result, [
			{ path: wt("my-app-1"), sourceRepo: repoCwd, dirty: true },
			{ path: wt("my-app-3"), sourceRepo: repoCwd, dirty: false },
		]);
	});

	it("returns an empty list when the root does not exist", async () => {
		const result = await listWorktreeLeftovers(worktreesRoot, [], {
			execFileImpl: fakeExec([]).execFileImpl,
			readdirImpl: async () => {
				throw new Error("ENOENT");
			},
			readFileImpl: () => {
				throw new Error("ENOENT");
			},
		});
		assert.deepEqual(result, []);
	});
});

describe("deleteLeftoverWorktree", () => {
	const target = join(worktreesRoot, "my-app-1");

	it("refuses paths outside the worktrees root and active task paths", async () => {
		await assert.rejects(
			deleteLeftoverWorktree(worktreesRoot, resolve("elsewhere", "x"), [], {
				execFileImpl: fakeExec([]).execFileImpl,
			}),
			/outside/iu,
		);
		await assert.rejects(
			deleteLeftoverWorktree(worktreesRoot, target, [target], { execFileImpl: fakeExec([]).execFileImpl }),
			/running/iu,
		);
	});

	it("force-removes through the source repo when it is known", async () => {
		const exec = fakeExec([{ stdout: "" }]);
		const removed = [];
		const result = await deleteLeftoverWorktree(worktreesRoot, target, [], {
			execFileImpl: exec.execFileImpl,
			readFileImpl: () => `gitdir: ${join(repoCwd, ".git", "worktrees", "my-app-1")}\n`,
			rmImpl: (path) => removed.push(path),
		});
		assert.deepEqual(result, { deleted: true });
		assert.deepEqual(exec.calls[0].args.slice(-4), ["worktree", "remove", "--force", target]);
		assert.deepEqual(removed, [], "no direct rm when git handled it");
	});

	it("falls back to removing the directory when git cannot", async () => {
		const exec = fakeExec([
			{ error: new Error("exit 128"), stderr: "fatal: not a working tree" }, // worktree remove
			{ stdout: "" }, // prune
		]);
		const removed = [];
		const result = await deleteLeftoverWorktree(worktreesRoot, target, [], {
			execFileImpl: exec.execFileImpl,
			readFileImpl: () => `gitdir: ${join(repoCwd, ".git", "worktrees", "my-app-1")}\n`,
			rmImpl: (path) => removed.push(path),
		});
		assert.deepEqual(result, { deleted: true });
		assert.deepEqual(removed, [target]);
		assert.deepEqual(exec.calls.at(-1).args.slice(-2), ["worktree", "prune"]);
	});

	it("removes an orphan directly when no source repo is recorded", async () => {
		const removed = [];
		const result = await deleteLeftoverWorktree(worktreesRoot, target, [], {
			execFileImpl: fakeExec([]).execFileImpl,
			readFileImpl: () => {
				throw new Error("ENOENT");
			},
			rmImpl: (path) => removed.push(path),
		});
		assert.deepEqual(result, { deleted: true });
		assert.deepEqual(removed, [target]);
	});
});

describe("removeTaskWorktree", () => {
	it("removes a clean worktree", async () => {
		const exec = fakeExec([{ stdout: "" }]);
		const result = await removeTaskWorktree(repoCwd, join(worktreesRoot, "my-app-1"), {
			execFileImpl: exec.execFileImpl,
		});
		assert.deepEqual(result, { removed: true });
		assert.deepEqual(exec.calls[0].args.slice(-3), ["worktree", "remove", join(worktreesRoot, "my-app-1")]);
	});

	it("keeps a dirty worktree and reports why", async () => {
		const exec = fakeExec([
			{ error: new Error("exit 1"), stderr: "fatal: 'my-app-1' contains modified or untracked files" },
		]);
		const result = await removeTaskWorktree(repoCwd, join(worktreesRoot, "my-app-1"), {
			execFileImpl: exec.execFileImpl,
		});
		assert.equal(result.removed, false);
		assert.match(result.reason, /modified or untracked/);
	});
});
