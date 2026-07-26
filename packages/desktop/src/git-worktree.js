/**
 * Git worktree provisioning for same-repo parallel tasks (M3 —
 * docs/parallel-tasks-m3-tdd.md). A second task in an already-running
 * repository gets its own worktree under the app's worktrees root on a fresh
 * task/<name> branch. Follows the no-shell execFile pattern of git-commit.js;
 * pure name allocation is unit-tested without git.
 */

import { execFile } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { describeGitFailure, runGit, validateBranchName } from "./git-commit.js";
import { resolveWorktreeSourceRoot } from "./worktree-trust.js";

const GIT_TIMEOUT_MS = 15000;
const MAX_NAME_ATTEMPTS = 100;

/** Lowest free `<repo>-<n>` slot among the existing worktree directory names. */
export function pickWorktreeName(repoBasename, existingNames) {
	const sanitized = String(repoBasename ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/gu, "-")
		.replace(/^[-.]+|[-.]+$/gu, "");
	const base = sanitized || "repo";
	const taken = new Set(existingNames);
	for (let slot = 1; slot <= MAX_NAME_ATTEMPTS; slot++) {
		const candidate = `${base}-${slot}`;
		if (!taken.has(candidate)) return candidate;
	}
	throw new Error("Could not allocate a worktree name");
}

export async function isGitRepository(cwd, { execFileImpl = execFile, timeoutMs = GIT_TIMEOUT_MS } = {}) {
	const result = await runGit(cwd, ["rev-parse", "--git-dir"], execFileImpl, timeoutMs);
	return !result.error;
}

async function branchExists(repoCwd, branch, execFileImpl, timeoutMs) {
	const result = await runGit(
		repoCwd,
		["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
		execFileImpl,
		timeoutMs,
	);
	return !result.error;
}

/**
 * Provision `<worktreesRoot>/<repo>-<n>` on a new `task/<repo>-<n>` branch
 * (suffix-bumped past leftover branches from earlier tasks). Returns
 * { worktreePath, branch }.
 */
export async function createTaskWorktree(
	repoCwd,
	worktreesRoot,
	{
		execFileImpl = execFile,
		mkdirImpl = (path) => mkdir(path, { recursive: true }),
		readdirImpl = readdir,
		timeoutMs = GIT_TIMEOUT_MS,
	} = {},
) {
	await mkdirImpl(worktreesRoot);
	let existing = [];
	try {
		existing = await readdirImpl(worktreesRoot);
	} catch {
		// A fresh root has no entries.
	}
	const name = pickWorktreeName(basename(repoCwd), existing);
	const worktreePath = join(worktreesRoot, name);

	// Absorb admin records of worktrees whose directories are gone (crashes).
	await runGit(repoCwd, ["worktree", "prune"], execFileImpl, timeoutMs);

	let branch = `task/${name}`;
	for (let attempt = 2; await branchExists(repoCwd, branch, execFileImpl, timeoutMs); attempt++) {
		if (attempt > MAX_NAME_ATTEMPTS) throw new Error("Could not allocate a task branch name");
		branch = `task/${name}-${attempt}`;
	}
	const validated = validateBranchName(branch);
	if (!validated.ok) throw new Error(`Task branch: ${validated.reason}`);

	const added = await runGit(
		repoCwd,
		["worktree", "add", "-b", validated.name, worktreePath],
		execFileImpl,
		timeoutMs,
	);
	if (added.error) throw describeGitFailure("Could not create the task worktree", added);
	return { worktreePath, branch: validated.name };
}

/** Canonical comparison key, case-insensitive on Windows like the registry's. */
function pathKey(path) {
	const resolved = resolve(String(path ?? ""));
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Worktree directories under the app's root that no running task owns:
 * candidates for user-driven cleanup. Dirty state comes from a porcelain
 * status inside each worktree (null when git cannot answer).
 * @returns {Promise<Array<{path: string, sourceRepo: string | null, dirty: boolean | null}>>}
 */
export async function listWorktreeLeftovers(
	worktreesRoot,
	activeCwds,
	/** @type {{execFileImpl?: typeof execFile, readdirImpl?: typeof readdir, readFileImpl?: (path: string) => string, timeoutMs?: number}} */
	{ execFileImpl = execFile, readdirImpl = readdir, readFileImpl, timeoutMs = GIT_TIMEOUT_MS } = {},
) {
	let names = [];
	try {
		names = await readdirImpl(worktreesRoot);
	} catch {
		return [];
	}
	const active = new Set((activeCwds ?? []).map(pathKey));
	const leftovers = [];
	for (const name of names) {
		const path = join(worktreesRoot, name);
		if (active.has(pathKey(path))) continue;
		const sourceRepo = resolveWorktreeSourceRoot(path, readFileImpl);
		const status = await runGit(path, ["status", "--porcelain"], execFileImpl, timeoutMs);
		const dirty = status.error ? null : status.stdout.trim().length > 0;
		leftovers.push({ path, sourceRepo, dirty });
	}
	return leftovers;
}

/**
 * Delete a leftover worktree the user explicitly chose to discard. The path
 * must live inside the app's worktrees root and must not belong to a running
 * task. Prefers `git worktree remove --force` through the source repo (keeps
 * git's bookkeeping consistent), falling back to removing the directory and
 * pruning.
 */
export async function deleteLeftoverWorktree(
	worktreesRoot,
	targetPath,
	activeCwds,
	/** @type {{execFileImpl?: typeof execFile, readFileImpl?: (path: string) => string, rmImpl?: (path: string) => void, timeoutMs?: number}} */
	{
		execFileImpl = execFile,
		readFileImpl,
		rmImpl = (path) => rmSync(path, { recursive: true, force: true, maxRetries: 3 }),
		timeoutMs = GIT_TIMEOUT_MS,
	} = {},
) {
	const rootKey = pathKey(worktreesRoot);
	const targetKey = pathKey(targetPath);
	if (!targetKey.startsWith(rootKey + sep)) {
		throw new Error("The path is outside the app's worktrees folder");
	}
	if ((activeCwds ?? []).some((cwd) => pathKey(cwd) === targetKey)) {
		throw new Error("A task is still running in that worktree");
	}

	const sourceRepo = resolveWorktreeSourceRoot(targetPath, readFileImpl);
	if (sourceRepo) {
		const removed = await runGit(
			sourceRepo,
			["worktree", "remove", "--force", targetPath],
			execFileImpl,
			timeoutMs,
		);
		if (!removed.error) {
			return { deleted: true };
		}
		rmImpl(targetPath);
		await runGit(sourceRepo, ["worktree", "prune"], execFileImpl, timeoutMs);
		return { deleted: true };
	}
	rmImpl(targetPath);
	return { deleted: true };
}

/**
 * Remove a task's worktree. Refuses to destroy local changes: a dirty or busy
 * worktree is left in place with the reason reported, never forced.
 */
export async function removeTaskWorktree(
	repoCwd,
	worktreePath,
	{ execFileImpl = execFile, timeoutMs = GIT_TIMEOUT_MS } = {},
) {
	const result = await runGit(repoCwd, ["worktree", "remove", worktreePath], execFileImpl, timeoutMs);
	if (result.error) {
		const detail = (result.stderr.trim() || result.stdout.trim() || String(result.error.message ?? "")).slice(0, 300);
		return { removed: false, reason: detail };
	}
	return { removed: true };
}
