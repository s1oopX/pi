/**
 * Resolving a git worktree back to its source repository, so project trust
 * can follow the repository identity: a folder the user already trusted stays
 * trusted when the app runs a task in one of its worktrees. Pure string work
 * plus one injectable file read; no git invocation. Plain JS so the Electron
 * main process, the Bun-bundled backend, and node:test can all import it.
 */

import { readFileSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";

/**
 * Extract the gitdir target from a linked worktree's `.git` file content.
 * @param {string} content
 * @returns {string | null}
 */
export function parseWorktreeGitdir(content) {
	const match = /^gitdir:\s*(.+)\s*$/mu.exec(String(content ?? ""));
	const target = match?.[1]?.trim();
	return target ? target : null;
}

/**
 * A linked worktree's gitdir lives at `<root>/.git/worktrees/<name>`; map it
 * back to `<root>`. Returns null for anything else (a normal checkout's
 * gitdir, or unrelated paths).
 * @param {string} gitdirPath
 * @returns {string | null}
 */
export function deriveWorktreeSourceRoot(gitdirPath) {
	const normalized = normalize(String(gitdirPath ?? ""));
	const segments = normalized.split(sep);
	const worktreesIndex = segments.lastIndexOf("worktrees");
	if (worktreesIndex < 2 || worktreesIndex !== segments.length - 2) return null;
	if (segments[worktreesIndex - 1] !== ".git") return null;
	const rootSegments = segments.slice(0, worktreesIndex - 1);
	if (rootSegments.length === 0) return null;
	return rootSegments.join(sep);
}

/**
 * Resolve the source repository root for a worktree cwd, or null when the cwd
 * is not a linked worktree (regular checkouts keep `.git` as a directory,
 * which makes the read throw).
 * @param {string} cwd
 * @param {(path: string) => string} [readImpl]
 * @returns {string | null}
 */
export function resolveWorktreeSourceRoot(cwd, readImpl = (path) => readFileSync(path, "utf8")) {
	try {
		const gitdir = parseWorktreeGitdir(readImpl(join(cwd, ".git")));
		return gitdir ? deriveWorktreeSourceRoot(gitdir) : null;
	} catch {
		return null;
	}
}

/**
 * Whether two paths name the same directory, judged by filesystem identity
 * (device + inode) rather than string comparison — immune to 8.3 short
 * names, case differences, and separator styles that defeat any string
 * canonicalization across processes.
 * @param {string} a
 * @param {string} b
 * @param {(path: string) => { dev: bigint, ino: bigint }} [statImpl]
 * @returns {boolean}
 */
export function directoriesShareIdentity(
	a,
	b,
	statImpl = (path) => {
		const stats = statSync(path, { bigint: true });
		return { dev: stats.dev, ino: stats.ino };
	},
) {
	try {
		const left = statImpl(a);
		const right = statImpl(b);
		return left.dev === right.dev && left.ino === right.ino && left.ino !== 0n;
	} catch {
		return false;
	}
}
