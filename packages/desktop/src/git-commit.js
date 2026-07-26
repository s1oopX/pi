/**
 * Git change listing and commit-all for the workspace, following the
 * no-shell canonicalized invocation pattern of git-workspace-status.js.
 * Pure helpers are unit-tested without Electron.
 */

import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";

const GIT_TIMEOUT_MS = 15000;
const GIT_MAX_BUFFER_BYTES = 1024 * 1024;
const MAX_LISTED_CHANGES = 200;
const MAX_COMMIT_MESSAGE_LENGTH = 5000;

const GIT_BASE_ARGS = ["-c", "color.status=false", "-c", "core.quotepath=false"];

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

function runGit(cwd, args, execFileImpl, timeoutMs) {
	return new Promise((resolve) => {
		const complete = (error, stdout = "", stderr = "") => {
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

function describeGitFailure(action, result) {
	const stderr = result.stderr.trim();
	const stdout = result.stdout.trim();
	const detail = (stderr || stdout || String(result.error?.message ?? "unknown error")).slice(0, 500);
	return new Error(`${action}: ${detail}`);
}

async function resolveWorkspaceDir(workspace, realpathImpl, statImpl) {
	if (typeof workspace !== "string" || !workspace.trim()) {
		throw new Error("Workspace not set");
	}
	const cwd = await realpathImpl(workspace);
	if (!(await statImpl(cwd)).isDirectory()) {
		throw new Error("Workspace is not a directory");
	}
	return cwd;
}

export async function listGitChanges(
	workspace,
	{ execFileImpl = execFile, realpathImpl = realpath, statImpl = stat, timeoutMs = GIT_TIMEOUT_MS } = {},
) {
	const cwd = await resolveWorkspaceDir(workspace, realpathImpl, statImpl);
	const result = await runGit(cwd, ["status", "--porcelain", "--untracked-files=normal"], execFileImpl, timeoutMs);
	if (result.error) throw describeGitFailure("Could not list changes", result);
	return parseGitPorcelainChanges(result.stdout);
}

export async function commitAllChanges(
	workspace,
	message,
	{ execFileImpl = execFile, realpathImpl = realpath, statImpl = stat, timeoutMs = GIT_TIMEOUT_MS } = {},
) {
	const validated = validateCommitMessage(message);
	if (!validated.ok) throw new Error(validated.reason);
	const cwd = await resolveWorkspaceDir(workspace, realpathImpl, statImpl);

	const addResult = await runGit(cwd, ["add", "--all"], execFileImpl, timeoutMs);
	if (addResult.error) throw describeGitFailure("Could not stage changes", addResult);

	const commitResult = await runGit(cwd, ["commit", "-m", validated.message], execFileImpl, timeoutMs);
	if (commitResult.error) {
		const combined = `${commitResult.stdout}\n${commitResult.stderr}`;
		if (/nothing to commit|no changes added to commit/iu.test(combined)) {
			throw new Error("Nothing to commit");
		}
		throw describeGitFailure("Commit failed", commitResult);
	}
	const summary = commitResult.stdout.split(/\r?\n/u).find((line) => line.trim()) ?? "Committed";
	return { committed: true, summary: summary.trim() };
}

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
