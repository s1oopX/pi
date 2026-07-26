/**
 * Registry mapping parallel tasks to backend handles (parallel tasks M2 —
 * docs/parallel-tasks-m2-tdd.md, phase A1). Owns the id space, the pool cap,
 * and the one-running-task-per-folder rule; the handles own their processes.
 * Pure bookkeeping: no fs and no Electron, so it unit-tests with fakes.
 */

import { resolve } from "node:path";

const DEFAULT_MAX_TASKS = 3;
const MIN_MAX_TASKS = 1;
const MAX_MAX_TASKS = 5;

/** @param {string} cwd */
function canonicalCwd(cwd) {
	const resolved = resolve(String(cwd ?? ""));
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * @typedef {import("./backend-handle.js").BackendHandle} RegistryHandle
 * @typedef {{ branch?: string, sourceRepo?: string, worktreePath?: string }} TaskMeta
 * @typedef {{ taskId: string, cwd: () => string, handle: RegistryHandle, isPrimary: boolean, meta?: TaskMeta }} RegistryEntry
 */

/**
 * @param {object} options
 * @param {RegistryHandle} options.primary
 * @param {(id: string, cwd: string) => RegistryHandle} options.createHandle
 * @param {number} [options.maxTasks]
 */
export function createTaskRegistry({ primary, createHandle, maxTasks = DEFAULT_MAX_TASKS }) {
	/** @type {RegistryEntry} */
	const primaryEntry = { taskId: primary.id, cwd: () => primary.getCwd(), handle: primary, isPrimary: true };
	/** @type {Map<string, RegistryEntry>} */
	const pool = new Map();
	let taskCounter = 0;
	let poolCap = Math.min(MAX_MAX_TASKS, Math.max(MIN_MAX_TASKS, maxTasks));

	/** @param {RegistryEntry} entry */
	function snapshot(entry) {
		return {
			taskId: entry.taskId,
			cwd: entry.cwd(),
			isPrimary: entry.isPrimary,
			ready: Boolean(entry.handle.ready),
			starting: Boolean(entry.handle.starting),
			// Worktree tasks carry their provenance for display and cleanup.
			...(entry.meta?.branch ? { branch: entry.meta.branch } : {}),
			...(entry.meta?.sourceRepo ? { sourceRepo: entry.meta.sourceRepo } : {}),
		};
	}

	/** @param {string} cwd */
	function findClaim(cwd) {
		const wanted = canonicalCwd(cwd);
		if (canonicalCwd(primaryEntry.cwd()) === wanted) return primaryEntry;
		for (const entry of pool.values()) {
			if (canonicalCwd(entry.cwd()) === wanted) return entry;
		}
		return undefined;
	}

	return {
		/** True when the folder is already running as the primary or a task. */
		/** @param {string} cwd */
		isClaimed(cwd) {
			return Boolean(findClaim(cwd));
		},

		/** Throws the cap error early, before any expensive provisioning. */
		assertCapacity() {
			if (pool.size >= poolCap) {
				const running = [...pool.values()].map((entry) => `${entry.taskId} (${entry.cwd()})`).join(", ");
				throw new Error(`Task limit reached (${poolCap}). Stop one first — running: ${running}`);
			}
		},

		/**
		 * @param {string} cwd
		 * @param {TaskMeta} [meta]
		 */
		create(cwd, meta) {
			if (pool.size >= poolCap) {
				const running = [...pool.values()].map((entry) => `${entry.taskId} (${entry.cwd()})`).join(", ");
				throw new Error(`Task limit reached (${poolCap}). Stop one first — running: ${running}`);
			}
			const claim = findClaim(cwd);
			if (claim) {
				throw new Error(
					claim.isPrimary
						? `That folder is the primary workspace and already running`
						: `A task is already running in that folder: ${claim.taskId}`,
				);
			}
			const taskId = `task_${++taskCounter}`;
			const fixedCwd = String(cwd);
			const handle = createHandle(taskId, fixedCwd);
			const entry = { taskId, cwd: () => fixedCwd, handle, isPrimary: false, meta };
			pool.set(taskId, entry);
			handle.start();
			return snapshot(entry);
		},

		/** @param {string | undefined | null} [taskId] */
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

		/** @param {string} taskId */
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

		getMaxTasks() {
			return poolCap;
		},

		/** @param {unknown} next */
		setMaxTasks(next) {
			const parsed = Number(next);
			if (Number.isFinite(parsed)) {
				poolCap = Math.min(MAX_MAX_TASKS, Math.max(MIN_MAX_TASKS, Math.round(parsed)));
			}
			return poolCap;
		},

		/**
		 * Pool tasks whose backend has been silent past the idle window. The
		 * primary and the renderer's active task are never candidates.
		 */
		/**
		 * @param {number} nowMs
		 * @param {number} idleMs
		 */
		listIdle(nowMs, idleMs, /** @type {{ skipTaskId?: string }} */ { skipTaskId } = {}) {
			/** @type {string[]} */
			const idle = [];
			for (const entry of pool.values()) {
				if (entry.taskId === skipTaskId) continue;
				const last = Number(entry.handle.lastActivityAt ?? 0);
				if (nowMs - last >= idleMs) idle.push(entry.taskId);
			}
			return idle;
		},
	};
}
