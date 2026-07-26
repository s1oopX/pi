/**
 * Registry mapping parallel tasks to backend handles (parallel tasks M2 —
 * docs/parallel-tasks-m2-tdd.md, phase A1). Owns the id space, the pool cap,
 * and the one-running-task-per-folder rule; the handles own their processes.
 * Pure bookkeeping: no fs and no Electron, so it unit-tests with fakes.
 */

import { resolve } from "node:path";

const DEFAULT_MAX_TASKS = 3;

function canonicalCwd(cwd) {
	const resolved = resolve(String(cwd ?? ""));
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function createTaskRegistry({ primary, createHandle, maxTasks = DEFAULT_MAX_TASKS }) {
	const primaryEntry = { taskId: primary.id, cwd: () => primary.getCwd(), handle: primary, isPrimary: true };
	/** @type {Map<string, {taskId: string, cwd: () => string, handle: object, isPrimary: boolean}>} */
	const pool = new Map();
	let taskCounter = 0;

	function snapshot(entry) {
		return {
			taskId: entry.taskId,
			cwd: entry.cwd(),
			isPrimary: entry.isPrimary,
			ready: Boolean(entry.handle.ready),
			starting: Boolean(entry.handle.starting),
		};
	}

	function findClaim(cwd) {
		const wanted = canonicalCwd(cwd);
		if (canonicalCwd(primaryEntry.cwd()) === wanted) return primaryEntry;
		for (const entry of pool.values()) {
			if (canonicalCwd(entry.cwd()) === wanted) return entry;
		}
		return undefined;
	}

	return {
		create(cwd) {
			if (pool.size >= maxTasks) {
				const running = [...pool.values()].map((entry) => `${entry.taskId} (${entry.cwd()})`).join(", ");
				throw new Error(`Task limit reached (${maxTasks}). Stop one first — running: ${running}`);
			}
			const claim = findClaim(cwd);
			if (claim) {
				throw new Error(
					claim.isPrimary
						? `That folder is the primary workspace and already running (same-repo isolation lands in M3)`
						: `A task is already running in that folder: ${claim.taskId} (same-repo isolation lands in M3)`,
				);
			}
			const taskId = `task_${++taskCounter}`;
			const fixedCwd = String(cwd);
			const handle = createHandle(taskId, fixedCwd);
			const entry = { taskId, cwd: () => fixedCwd, handle, isPrimary: false };
			pool.set(taskId, entry);
			handle.start();
			return snapshot(entry);
		},

		get(taskId) {
			if (taskId === undefined || taskId === null || taskId === primaryEntry.taskId) {
				return primaryEntry;
			}
			const entry = pool.get(taskId);
			if (!entry) {
				throw new Error(`Unknown task: ${taskId}`);
			}
			return entry;
		},

		stop(taskId) {
			if (taskId === primaryEntry.taskId) {
				throw new Error("The primary workspace backend cannot be stopped as a task");
			}
			const entry = pool.get(taskId);
			if (!entry) {
				throw new Error(`Unknown task: ${taskId}`);
			}
			pool.delete(taskId);
			entry.handle.stop();
			return { stopped: true, taskId };
		},

		list() {
			return [primaryEntry, ...pool.values()].map(snapshot);
		},

		stopAll() {
			primaryEntry.handle.stop();
			for (const entry of pool.values()) {
				entry.handle.stop();
			}
			pool.clear();
		},
	};
}
