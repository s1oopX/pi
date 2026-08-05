import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const TASK_STATE_VERSION = 1;
const MAX_TASK_STATE_BYTES = 64 * 1024;
// Five live tasks plus five entries retained when their workspace is temporarily unavailable.
const MAX_STORED_TASKS = 10;
const TASK_ID = /^task_[1-9]\d*$/u;
let temporaryFileCounter = 0;

/**
 * @typedef {{
 *   taskId: string,
 *   cwd: string,
 *   branch?: string,
 *   sourceRepo?: string,
 *   worktreePath?: string,
 *   sessionFile?: string,
 *   unread?: number,
 *   completed?: boolean,
 * }} StoredTask
 */

/** @param {unknown} value @param {string} label @param {number} maxLength */
function optionalText(value, label, maxLength) {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !value.trim() || value.length > maxLength || value.includes("\0")) {
		throw new Error(`${label} is invalid`);
	}
	return value;
}

/** @param {string} contents @returns {StoredTask[]} */
export function parseTaskState(contents) {
	let parsed;
	try {
		parsed = JSON.parse(contents);
	} catch {
		throw new Error("Task state file is not valid JSON");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.version !== TASK_STATE_VERSION) {
		throw new Error("Task state file has an unsupported format");
	}
	if (!Array.isArray(parsed.tasks) || parsed.tasks.length > MAX_STORED_TASKS) {
		throw new Error("Task state file has an invalid task list");
	}
	const seen = new Set();
	const tasks = /** @type {unknown[]} */ (parsed.tasks);
	return tasks.map((value) => {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new Error("Task state file contains an invalid record");
		}
		const record = /** @type {Record<string, unknown>} */ (value);
		const taskId = optionalText(record.taskId, "Task id", 64);
		const cwd = optionalText(record.cwd, "Task workspace", 4096);
		if (!taskId || !TASK_ID.test(taskId) || !cwd || seen.has(taskId)) {
			throw new Error("Task state file contains an invalid record");
		}
		if (record.unread !== undefined && (!Number.isSafeInteger(record.unread) || Number(record.unread) < 0)) {
			throw new Error("Task unread count is invalid");
		}
		if (record.completed !== undefined && typeof record.completed !== "boolean") {
			throw new Error("Task completion flag is invalid");
		}
		seen.add(taskId);
		return {
			taskId,
			cwd,
			...(optionalText(record.branch, "Task branch", 500) ? { branch: String(record.branch) } : {}),
			...(optionalText(record.sourceRepo, "Task source repository", 4096)
				? { sourceRepo: String(record.sourceRepo) }
				: {}),
			...(optionalText(record.worktreePath, "Task worktree", 4096)
				? { worktreePath: String(record.worktreePath) }
				: {}),
			...(optionalText(record.sessionFile, "Task session file", 4096)
				? { sessionFile: String(record.sessionFile) }
				: {}),
			...(record.unread ? { unread: Number(record.unread) } : {}),
			...(record.completed ? { completed: true } : {}),
		};
	});
}

/** @param {string} path */
export function loadTaskState(path) {
	try {
		const stats = statSync(path);
		if (!stats.isFile() || stats.size > MAX_TASK_STATE_BYTES) {
			throw new Error("Task state file is invalid or too large");
		}
		return { tasks: parseTaskState(readFileSync(path, "utf8")) };
	} catch (error) {
		if (/** @type {{ code?: unknown }} */ (error)?.code === "ENOENT") return { tasks: [] };
		return { tasks: [], error: error instanceof Error ? error : new Error(String(error)) };
	}
}

/** @param {string} path @param {StoredTask[]} tasks */
export function saveTaskState(path, tasks) {
	const contents = `${JSON.stringify({ version: TASK_STATE_VERSION, tasks }, null, 2)}\n`;
	parseTaskState(contents);
	mkdirSync(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${++temporaryFileCounter}.tmp`;
	try {
		writeFileSync(temporaryPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
		renameSync(temporaryPath, path);
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}
