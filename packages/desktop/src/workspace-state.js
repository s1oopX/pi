import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const WORKSPACE_STATE_VERSION = 1;
const MAX_WORKSPACE_STATE_BYTES = 16 * 1024;
let temporaryFileCounter = 0;

/** @param {string} contents */
export function parseWorkspaceState(contents) {
	try {
		const state = JSON.parse(contents);
		if (
			!state ||
			typeof state !== "object" ||
			Array.isArray(state) ||
			state.version !== WORKSPACE_STATE_VERSION ||
			typeof state.cwd !== "string" ||
			!state.cwd.trim()
		) {
			return undefined;
		}
		return state.cwd;
	} catch {
		return undefined;
	}
}

/**
 * @param {string} contents
 * @param {(path: string) => boolean} isDirectory
 */
export function resolveStoredWorkspace(contents, isDirectory) {
	const cwd = parseWorkspaceState(contents);
	return cwd && isDirectory(cwd) ? cwd : undefined;
}

/** @param {string} path */
function isDirectory(path) {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/** @param {string} statePath */
export function loadStoredWorkspace(statePath) {
	try {
		const stateStats = statSync(statePath);
		if (!stateStats.isFile() || stateStats.size > MAX_WORKSPACE_STATE_BYTES) return undefined;
		return resolveStoredWorkspace(readFileSync(statePath, "utf8"), isDirectory);
	} catch {
		return undefined;
	}
}

/**
 * @param {string} statePath
 * @param {string} cwd
 */
export function saveStoredWorkspace(statePath, cwd) {
	if (typeof cwd !== "string" || !cwd.trim() || !isDirectory(cwd)) {
		throw new Error(`Workspace not found: ${cwd}`);
	}

	mkdirSync(dirname(statePath), { recursive: true });
	const contents = `${JSON.stringify({ version: WORKSPACE_STATE_VERSION, cwd })}\n`;
	const temporaryPath = `${statePath}.${process.pid}.${++temporaryFileCounter}.tmp`;
	try {
		writeFileSync(temporaryPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
		renameSync(temporaryPath, statePath);
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}
