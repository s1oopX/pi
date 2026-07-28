/**
 * Git change listing and commit-all for the workspace, following the
 * no-shell canonicalized invocation pattern of git-workspace-status.js.
 * Pure helpers are unit-tested without Electron.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const GIT_TIMEOUT_MS = 15000;
const GIT_MAX_BUFFER_BYTES = 1024 * 1024;
const MAX_LISTED_CHANGES = 200;
const MAX_COMMIT_MESSAGE_LENGTH = 5000;

const GIT_BASE_ARGS = ["-c", "color.status=false", "-c", "core.quotepath=false"];

/**
 * @typedef {{ error: unknown, stdout: string, stderr: string }} GitRunResult
 * @typedef {(path: string) => Promise<string>} RealpathImpl
 * @typedef {(path: string) => Promise<{ isDirectory: () => boolean }>} StatImpl
 */

/** @param {string} output */
export function parseGitPorcelainChanges(output) {
	const files = [];
	let truncated = false;
	for (const line of String(output ?? "").split(/\r?\n/u)) {
		if (!line.trim()) continue;
		const status = line.slice(0, 2).trim() || "??";
		const rest = line.slice(3);
		const path = rest.includes(" -> ") ? rest.split(" -> ").pop() : rest;
		if (!path) continue;
		if (files.length >= MAX_LISTED_CHANGES) {
			truncated = true;
			break;
		}
		files.push({ status, path });
	}
	return { files, truncated };
}

/**
 * @param {unknown} message
 * @returns {{ ok: false, reason: string } | { ok: true, message: string }}
 */
export function validateCommitMessage(message) {
	const trimmed = String(message ?? "").trim();
	if (!trimmed) return { ok: false, reason: "Commit message is required" };
	if (trimmed.length > MAX_COMMIT_MESSAGE_LENGTH) return { ok: false, reason: "Commit message is too long" };
	return { ok: true, message: trimmed };
}

/**
 * Validate a branch name before it becomes a git argument. Rejects anything
 * that could be mistaken for a flag or that git itself refuses, so a name can
 * never inject options into the execFile argv.
 */
/**
 * @param {unknown} name
 * @returns {{ ok: false, reason: string } | { ok: true, name: string }}
 */
export function validateBranchName(name) {
	const trimmed = String(name ?? "").trim();
	if (!trimmed) return { ok: false, reason: "Branch name is required" };
	if (trimmed.length > 240) return { ok: false, reason: "Branch name is too long" };
	if (trimmed.startsWith("-")) return { ok: false, reason: "Branch name cannot start with '-'" };
	// git check-ref-format rules (subset): no spaces or control chars, none of
	// ~^:?*[\, no "..", no "@{", no leading/trailing "/" or ".", no ".lock" suffix.
	if (/[\s~^:?*[\\\x00-\x1f\x7f]/u.test(trimmed)) return { ok: false, reason: "Branch name has invalid characters" };
	if (trimmed.includes("..") || trimmed.includes("@{")) return { ok: false, reason: "Branch name has invalid characters" };
	if (/^[./]|[./]$|\.lock$/u.test(trimmed)) return { ok: false, reason: "Branch name has invalid boundaries" };
	return { ok: true, name: trimmed };
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {import("node:child_process").execFile} execFileImpl
 * @param {number} timeoutMs
 * @returns {Promise<GitRunResult>}
 */
export function runGit(cwd, args, execFileImpl, timeoutMs) {
	return new Promise((resolve) => {
		const complete = (/** @type {unknown} */ error, stdout = "", stderr = "") => {
			resolve({ error, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
		};
		try {
			execFileImpl(
				"git",
				[...GIT_BASE_ARGS, ...args],
				{
					cwd,
					encoding: "utf8",
					env: {
						...process.env,
						GIT_OPTIONAL_LOCKS: "0",
						LANG: "C",
						LC_ALL: "C",
					},
					maxBuffer: GIT_MAX_BUFFER_BYTES,
					shell: false,
					timeout: timeoutMs,
					windowsHide: true,
				},
				complete,
			);
		} catch (error) {
			complete(error);
		}
	});
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {string} input
 * @param {import("node:child_process").execFile} execFileImpl
 * @param {number} timeoutMs
 * @returns {Promise<GitRunResult>}
 */
export function runGitWithInput(cwd, args, input, execFileImpl, timeoutMs) {
	return new Promise((resolveResult) => {
		const complete = (/** @type {unknown} */ error, stdout = "", stderr = "") => {
			resolveResult({ error, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
		};
		try {
			const child = execFileImpl(
				"git",
				[...GIT_BASE_ARGS, ...args],
				{
					cwd,
					encoding: "utf8",
					env: {
						...process.env,
						GIT_OPTIONAL_LOCKS: "0",
						LANG: "C",
						LC_ALL: "C",
					},
					maxBuffer: GIT_MAX_BUFFER_BYTES,
					shell: false,
					timeout: timeoutMs,
					windowsHide: true,
				},
				complete,
			);
			if (!child.stdin) {
				complete(new Error("Could not open git stdin"));
				return;
			}
			child.stdin.on("error", () => {});
			child.stdin.end(input);
		} catch (error) {
			complete(error);
		}
	});
}

/**
 * @param {string} action
 * @param {GitRunResult} result
 */
export function describeGitFailure(action, result) {
	const stderr = result.stderr.trim();
	const stdout = result.stdout.trim();
	const detail = (stderr || stdout || (result.error instanceof Error ? result.error.message : "unknown error")).slice(
		0,
		500,
	);
	return new Error(`${action}: ${detail}`);
}

/**
 * @param {unknown} workspace
 * @param {RealpathImpl} realpathImpl
 * @param {StatImpl} statImpl
 */
export async function resolveWorkspaceDir(workspace, realpathImpl, statImpl) {
	if (typeof workspace !== "string" || !workspace.trim()) {
		throw new Error("Workspace not set");
	}
	const cwd = await realpathImpl(workspace);
	if (!(await statImpl(cwd)).isDirectory()) {
		throw new Error("Workspace is not a directory");
	}
	return cwd;
}

/** @param {string} workspace */
export async function listGitChanges(
	workspace,
	{ execFileImpl = execFile, realpathImpl = realpath, statImpl = stat, timeoutMs = GIT_TIMEOUT_MS } = {},
) {
	const cwd = await resolveWorkspaceDir(workspace, realpathImpl, statImpl);
	const result = await runGit(cwd, ["status", "--porcelain", "--untracked-files=normal"], execFileImpl, timeoutMs);
	if (result.error) throw describeGitFailure("Could not list changes", result);
	return parseGitPorcelainChanges(result.stdout);
}

/**
 * @param {string} workspace
 * @param {string} message
 */
export async function commitAllChanges(
	workspace,
	message,
	{ execFileImpl = execFile, realpathImpl = realpath, statImpl = stat, timeoutMs = GIT_TIMEOUT_MS } = {},
) {
	const validated = validateCommitMessage(message);
	if (!validated.ok) throw new Error(validated.reason);
	const cwd = await resolveWorkspaceDir(workspace, realpathImpl, statImpl);

	const stagedResult = await runGit(cwd, ["diff", "--cached", "--name-only"], execFileImpl, timeoutMs);
	if (stagedResult.error) throw describeGitFailure("Could not inspect staged changes", stagedResult);
	if (!stagedResult.stdout.trim()) {
		const addResult = await runGit(cwd, ["add", "--all"], execFileImpl, timeoutMs);
		if (addResult.error) throw describeGitFailure("Could not stage changes", addResult);
	}

	const commitResult = await runGit(cwd, ["commit", "-m", validated.message], execFileImpl, timeoutMs);
	if (commitResult.error) {
		const combined = `${commitResult.stdout}\n${commitResult.stderr}`;
		if (/nothing to commit|no changes added to commit/iu.test(combined)) {
			throw new Error("Nothing to commit");
		}
		throw describeGitFailure("Commit failed", commitResult);
	}
	const summary = commitResult.stdout.split(/\r?\n/u).find((/** @type {string} */ line) => line.trim()) ?? "Committed";
	return { committed: true, summary: summary.trim() };
}

/** @param {string} workspace */
export async function listGitBranches(
	workspace,
	{ execFileImpl = execFile, realpathImpl = realpath, statImpl = stat, timeoutMs = GIT_TIMEOUT_MS } = {},
) {
	const cwd = await resolveWorkspaceDir(workspace, realpathImpl, statImpl);
	// %(HEAD) is "*" for the checked-out branch, refname:short is the name.
	const result = await runGit(
		cwd,
		["for-each-ref", "--format=%(HEAD)%(refname:short)", "--sort=-committerdate", "refs/heads/"],
		execFileImpl,
		timeoutMs,
	);
	if (result.error) throw describeGitFailure("Could not list branches", result);
	const branches = [];
	let current = null;
	for (const line of result.stdout.split(/\r?\n/u)) {
		if (!line.trim()) continue;
		const isCurrent = line.startsWith("*");
		const name = line.slice(1);
		if (!name) continue;
		branches.push({ name, current: isCurrent });
		if (isCurrent) current = name;
	}
	return { branches, current };
}

/** @param {string} workspace */
export async function pushCurrentBranch(
	workspace,
	{ execFileImpl = execFile, realpathImpl = realpath, statImpl = stat, timeoutMs = GIT_TIMEOUT_MS } = {},
) {
	const cwd = await resolveWorkspaceDir(workspace, realpathImpl, statImpl);

	const headResult = await runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], execFileImpl, timeoutMs);
	if (headResult.error) throw new Error("Cannot push a detached HEAD; check out a branch first");
	const branch = headResult.stdout.trim();
	if (!branch) throw new Error("Cannot push a detached HEAD; check out a branch first");

	const upstreamResult = await runGit(
		cwd,
		["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
		execFileImpl,
		timeoutMs,
	);
	const hasUpstream = !upstreamResult.error && upstreamResult.stdout.trim().length > 0;

	const pushArgs = hasUpstream ? ["push"] : ["push", "--set-upstream", "origin", branch];
	const pushResult = await runGit(cwd, pushArgs, execFileImpl, timeoutMs);
	if (pushResult.error) throw describeGitFailure("Push failed", pushResult);
	// git reports push progress on stderr even on success.
	const summary =
		`${pushResult.stderr}\n${pushResult.stdout}`
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.find((line) => line && !/^remote:/u.test(line)) ?? `Pushed ${branch}`;
	return { pushed: true, branch, setUpstream: !hasUpstream, summary };
}

/**
 * @param {string} workspace
 * @param {string} name
 */
export async function switchGitBranch(
	workspace,
	name,
	{ create = false, execFileImpl = execFile, realpathImpl = realpath, statImpl = stat, timeoutMs = GIT_TIMEOUT_MS } = {},
) {
	const validated = validateBranchName(name);
	if (!validated.ok) throw new Error(validated.reason);
	const cwd = await resolveWorkspaceDir(workspace, realpathImpl, statImpl);

	// validateBranchName already guarantees the name can't be read as a flag
	// (no leading "-"), so no "--" separator is needed — and "--" would break
	// the --create form, where git takes the next token as the new branch name.
	const args = create ? ["switch", "--create", validated.name] : ["switch", validated.name];
	const result = await runGit(cwd, args, execFileImpl, timeoutMs);
	if (result.error) {
		const combined = `${result.stdout}\n${result.stderr}`;
		if (create && /already exists/iu.test(combined)) {
			throw new Error(`Branch "${validated.name}" already exists`);
		}
		if (!create && /invalid reference|did not match|unknown revision/iu.test(combined)) {
			throw new Error(`Branch "${validated.name}" not found`);
		}
		if (/local changes.*would be overwritten|overwritten by checkout/iu.test(combined)) {
			throw new Error("Commit or stash your changes before switching branches");
		}
		throw describeGitFailure("Could not switch branch", result);
	}
	return { switched: true, branch: validated.name, created: create };
}


/**
 * A worktree-relative path argument for git, required non-empty and contained
 * by the resolved workspace.
 * @param {string} cwd
 * @param {unknown} filePath
 */
function validateFilePath(cwd, filePath) {
	const target = String(filePath ?? "");
	if (!target.trim()) throw new Error("A file path is required");
	if (target.includes("\0") || isAbsolute(target)) throw new Error("File path must be relative to the workspace");
	const relativeTarget = relative(cwd, resolve(cwd, target));
	if (!relativeTarget || relativeTarget === ".." || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) {
		throw new Error("File path must stay inside the workspace");
	}
	return target;
}

/** @param {string} patch */
function patchHash(patch) {
	return createHash("sha256").update(patch).digest("hex");
}

/** @param {string} patch */
function patchHunkStarts(patch) {
	const lines = (patch.endsWith("\n") ? patch.slice(0, -1) : patch).split("\n");
	const starts = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (lines[index].startsWith("@@ ")) starts.push(index);
	}
	return { lines, starts };
}

/**
 * Select one unified-diff hunk while retaining the file header git needs.
 * @param {string} patch
 * @param {number} hunkIndex
 */
export function selectPatchHunk(patch, hunkIndex) {
	if (!Number.isSafeInteger(hunkIndex) || hunkIndex < 0) throw new Error("Invalid hunk index");
	const { lines, starts } = patchHunkStarts(patch);
	if (hunkIndex >= starts.length) throw new Error("Diff hunk is no longer available");
	const firstHunk = starts[0];
	const start = starts[hunkIndex];
	const end = starts[hunkIndex + 1] ?? lines.length;
	return `${[...lines.slice(0, firstHunk), ...lines.slice(start, end)].join("\n")}\n`;
}

/**
 * @param {string} patch
 * @param {boolean} canDiscard
 */
function describePatch(patch, canDiscard) {
	return {
		patch,
		hash: patchHash(patch),
		canDiscard,
	};
}

/**
 * @param {string} cwd
 * @param {string} target
 * @param {import("node:child_process").execFile} execFileImpl
 * @param {number} timeoutMs
 */
async function readFileDiff(cwd, target, execFileImpl, timeoutMs) {
	const inHeadResult = await runGit(cwd, ["ls-tree", "HEAD", "--", target], execFileImpl, timeoutMs);
	const inHead = !inHeadResult.error && Boolean(inHeadResult.stdout.trim());
	const stagedResult = await runGit(cwd, ["diff", "--cached", "--", target], execFileImpl, timeoutMs);
	if (stagedResult.error) throw describeGitFailure("Could not read staged changes", stagedResult);
	const unstagedResult = await runGit(cwd, ["diff", "--", target], execFileImpl, timeoutMs);
	if (unstagedResult.error) throw describeGitFailure("Could not read unstaged changes", unstagedResult);

	let unstagedPatch = unstagedResult.stdout;
	let untracked = false;
	if (!stagedResult.stdout.trim() && !unstagedPatch.trim()) {
		// `--no-index` exits 1 when the sides differ, so the output matters more
		// than the error flag here.
		const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
		const untrackedResult = await runGit(
			cwd,
			["diff", "--no-index", "--", nullDevice, target],
			execFileImpl,
			timeoutMs,
		);
		unstagedPatch = untrackedResult.stdout;
		untracked = Boolean(unstagedPatch.trim());
	}

	return {
		staged: describePatch(stagedResult.stdout, inHead),
		unstaged: describePatch(unstagedPatch, !untracked),
	};
}

/**
 * Separate staged (HEAD to index) and unstaged (index to worktree) patches for
 * one file. Untracked files fall back to a no-index pure-addition patch.
 * @param {string} workspace
 * @param {string} filePath
 */
export async function getFileDiff(
	workspace,
	filePath,
	{ execFileImpl = execFile, realpathImpl = realpath, statImpl = stat, timeoutMs = GIT_TIMEOUT_MS } = {},
) {
	const cwd = await resolveWorkspaceDir(workspace, realpathImpl, statImpl);
	const target = validateFilePath(cwd, filePath);
	return readFileDiff(cwd, target, execFileImpl, timeoutMs);
}

/**
 * Apply one server-selected hunk from the current staged or unstaged patch.
 * The renderer supplies only an index and hash; arbitrary patch text never
 * crosses the trust boundary.
 * @param {string} workspace
 * @param {string} filePath
 * @param {{ section?: unknown, action?: unknown, hunkIndex?: unknown, patchHash?: unknown }} selection
 */
export async function applyGitHunk(
	workspace,
	filePath,
	selection,
	{ execFileImpl = execFile, realpathImpl = realpath, statImpl = stat, timeoutMs = GIT_TIMEOUT_MS } = {},
) {
	const cwd = await resolveWorkspaceDir(workspace, realpathImpl, statImpl);
	const target = validateFilePath(cwd, filePath);
	const section = selection?.section;
	const action = selection?.action;
	const hunkIndex = typeof selection?.hunkIndex === "number" ? selection.hunkIndex : Number.NaN;
	const requestedHash = String(selection?.patchHash ?? "");
	/** @type {Record<string, string[]>} */
	const argsBySelection = {
		"unstaged:stage": ["apply", "--cached", "-"],
		"unstaged:discard": ["apply", "--reverse", "-"],
		"staged:unstage": ["apply", "--cached", "--reverse", "-"],
		"staged:discard": ["apply", "--index", "--reverse", "-"],
	};
	const args = argsBySelection[`${section}:${action}`];
	if (!args) throw new Error("Unsupported hunk action");

	const diff = await readFileDiff(cwd, target, execFileImpl, timeoutMs);
	const patchSection = section === "staged" ? diff.staged : diff.unstaged;
	if (requestedHash !== patchSection.hash) throw new Error("Diff changed; refresh it and try again");
	if (action === "discard" && !patchSection.canDiscard) {
		throw new Error("Discard the whole new file to move it to the Recycle Bin");
	}
	const patch = selectPatchHunk(patchSection.patch, hunkIndex);
	const result = await runGitWithInput(cwd, args, patch, execFileImpl, timeoutMs);
	if (result.error) throw describeGitFailure(`Could not ${String(action)} hunk`, result);
	return { applied: true, section, action };
}

/**
 * Discard a file's uncommitted changes. Files known to HEAD are restored in
 * both the index and the worktree; a newly staged file is only unstaged and
 * reported untracked so the caller can decide what to do with the file itself
 * (the desktop moves it to the recycle bin rather than deleting).
 * @param {string} workspace
 * @param {string} filePath
 * @returns {Promise<{ restored: boolean, untracked: boolean }>}
 */
export async function restoreFileChanges(
	workspace,
	filePath,
	{ execFileImpl = execFile, realpathImpl = realpath, statImpl = stat, timeoutMs = GIT_TIMEOUT_MS } = {},
) {
	const cwd = await resolveWorkspaceDir(workspace, realpathImpl, statImpl);
	const target = validateFilePath(cwd, filePath);

	const inHead = await runGit(cwd, ["ls-tree", "HEAD", "--", target], execFileImpl, timeoutMs);
	if (!inHead.error && inHead.stdout.trim()) {
		const restored = await runGit(
			cwd,
			["restore", "--worktree", "--staged", "--source=HEAD", "--", target],
			execFileImpl,
			timeoutMs,
		);
		if (restored.error) throw describeGitFailure("Could not restore the file", restored);
		return { restored: true, untracked: false };
	}

	const inIndex = await runGit(cwd, ["ls-files", "--error-unmatch", "--", target], execFileImpl, timeoutMs);
	if (!inIndex.error && inIndex.stdout.trim()) {
		const unstaged = await runGit(cwd, ["restore", "--staged", "--", target], execFileImpl, timeoutMs);
		if (unstaged.error) throw describeGitFailure("Could not unstage the file", unstaged);
	}
	return { restored: false, untracked: true };
}
