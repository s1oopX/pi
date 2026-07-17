/**
 * Resolve a workspace-relative or absolute path for OS reveal/open.
 * Pure helpers are unit-tested without Electron.
 */

import { isAbsolute, normalize, resolve, sep } from "node:path";

/**
 * @param {string} workspaceCwd
 * @param {string} targetPath
 * @returns {string}
 */
export function resolveWorkspacePath(workspaceCwd, targetPath) {
	// Do not normalize before empty checks: path.normalize("") becomes ".".
	const cwdRaw = String(workspaceCwd ?? "").trim();
	const target = String(targetPath ?? "").trim();
	if (!cwdRaw) {
		throw new Error("Workspace not set");
	}
	if (!target) {
		throw new Error("Path is empty");
	}
	const cwd = normalize(cwdRaw);
	const absolute = isAbsolute(target) ? normalize(target) : normalize(resolve(cwd, target));
	return absolute;
}

/**
 * Soft containment check: resolved path must stay under workspace when possible.
 * Absolute paths outside the workspace are still allowed (agent may touch them)
 * but are returned as-is for reveal.
 *
 * @param {string} workspaceCwd
 * @param {string} absolutePath
 * @returns {{ absolutePath: string, insideWorkspace: boolean }}
 */
export function describeRevealTarget(workspaceCwd, absolutePath) {
	const cwdRaw = String(workspaceCwd ?? "").trim();
	const absRaw = String(absolutePath ?? "").trim();
	if (!cwdRaw || !absRaw) {
		throw new Error("Path is empty");
	}
	const cwd = normalize(cwdRaw);
	const abs = normalize(absRaw);
	const cwdPrefix = cwd.endsWith(sep) ? cwd : `${cwd}${sep}`;
	const insideWorkspace =
		abs === cwd || abs.toLowerCase().startsWith(cwdPrefix.toLowerCase()) || abs.toLowerCase() === cwd.toLowerCase();
	return { absolutePath: abs, insideWorkspace };
}
