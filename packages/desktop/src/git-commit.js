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
