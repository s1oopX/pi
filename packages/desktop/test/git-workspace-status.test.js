import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getGitWorkspaceStatus, parseGitStatusOutput } from "../src/git-workspace-status.js";

test("parses branch and clean status from porcelain v2 output", () => {
	assert.deepEqual(
		parseGitStatusOutput("# branch.oid abcdef\n# branch.head main\n# branch.upstream origin/main\n"),
		{
			kind: "repository",
			branch: "main",
			detached: false,
			dirty: false,
		},
	);
});

test("detects detached HEAD and dirty tracked or untracked files", () => {
	assert.deepEqual(
		parseGitStatusOutput("# branch.oid abcdef\n# branch.head (detached)\n1 .M N... 100644 100644 100644 abc abc file.js\n"),
		{
			kind: "repository",
			branch: null,
			detached: true,
			dirty: true,
		},
	);
	assert.equal(parseGitStatusOutput("# branch.head feature\n? new-file.txt\n").dirty, true);
});

test("runs git without a shell in a canonical, validated workspace", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "pi-studio-git-status-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const workspace = join(root, "workspace");
	mkdirSync(workspace);
	const canonicalWorkspace = await realpath(workspace);
	let invocation;

	const status = await getGitWorkspaceStatus(workspace, {
		execFileImpl: (file, args, options, callback) => {
			invocation = { file, args, options };
			callback(null, "# branch.oid abcdef\n# branch.head topic\n", "");
		},
	});

	assert.equal(status.kind, "repository");
	assert.equal(status.branch, "topic");
	assert.equal(invocation.file, "git");
	assert.deepEqual(invocation.args, [
		"-c",
		"color.status=false",
		"status",
		"--porcelain=v2",
		"--branch",
		"--untracked-files=normal",
	]);
	assert.equal(invocation.options.cwd, canonicalWorkspace);
	assert.equal(invocation.options.shell, false);
	assert.equal(invocation.options.timeout, 2000);
	assert.equal(invocation.options.maxBuffer, 256 * 1024);
	assert.equal(invocation.options.env.GIT_OPTIONAL_LOCKS, "0");
});

test("returns a neutral status outside a git repository", async (t) => {
	const workspace = mkdtempSync(join(tmpdir(), "pi-studio-git-status-"));
	t.after(() => rmSync(workspace, { recursive: true, force: true }));
	const gitError = new Error("git failed");
	gitError.code = 128;

	const status = await getGitWorkspaceStatus(workspace, {
		execFileImpl: (_file, _args, _options, callback) => {
			callback(gitError, "", "fatal: not a git repository (or any parent directories): .git\n");
		},
	});

	assert.deepEqual(status, {
		kind: "not-repository",
		branch: null,
		detached: false,
		dirty: false,
	});
});

test("maps timeouts and command failures to a non-sensitive unavailable status", async (t) => {
	const workspace = mkdtempSync(join(tmpdir(), "pi-studio-git-status-"));
	t.after(() => rmSync(workspace, { recursive: true, force: true }));
	const expected = {
		kind: "unavailable",
		branch: null,
		detached: false,
		dirty: false,
	};
	const timeoutError = new Error(`timed out in ${join(workspace, "private")}`);
	timeoutError.killed = true;
	const failureError = new Error(`could not execute in ${workspace}`);
	failureError.code = "ENOENT";

	for (const error of [timeoutError, failureError]) {
		const status = await getGitWorkspaceStatus(workspace, {
			execFileImpl: (_file, _args, _options, callback) => {
				callback(error, "", `sensitive path: ${workspace}`);
			},
		});
		assert.deepEqual(status, expected);
		assert.equal(JSON.stringify(status).includes(workspace), false);
	}
});

test("does not execute git for a missing or non-directory workspace", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "pi-studio-git-status-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	let invoked = false;
	const status = await getGitWorkspaceStatus(join(root, "missing"), {
		execFileImpl: () => {
			invoked = true;
		},
	});

	assert.equal(invoked, false);
	assert.equal(status.kind, "unavailable");
});
