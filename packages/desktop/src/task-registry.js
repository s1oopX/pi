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
	const value = String(cwd ?? "");
	if (value.startsWith("ssh://")) return value;
	const resolved = resolve(value);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * @typedef {import("./backend-handle.js").BackendHandle} RegistryHandle
 * @typedef {{ branch?: string, sourceRepo?: string, worktreePath?: string }} TaskMeta
 * @typedef {{ unread?: number, completed?: boolean }} TaskActivity
 * @typedef {{ taskId: string, cwd: () => string, handle: RegistryHandle, isPrimary: boolean, streaming: boolean, unread: number, completed: boolean, meta?: TaskMeta }} RegistryEntry
 */

/**
 * @param {object} options
 * @param {RegistryHandle} options.primary
 * @param {(id: string, cwd: string, sessionFile?: string) => RegistryHandle} options.createHandle
 * @param {number} [options.maxTasks]
 */
export function createTaskRegistry({ primary, createHandle, maxTasks = DEFAULT_MAX_TASKS }) {
	/** @type {RegistryEntry} */
	const primaryEntry = {
		taskId: primary.id,
		cwd: () => primary.getCwd(),
		handle: primary,
		isPrimary: true,
		streaming: false,
		unread: 0,
		completed: false,
	};
	/** @type {Map<string, RegistryEntry>} */
	const pool = new Map();
	let taskCounter = 0;
	let poolCap = Math.min(MAX_MAX_TASKS, Math.max(MIN_MAX_TASKS, maxTasks));

	/** @param {string} taskId */
	function reserveTaskId(taskId) {
		if (!/^task_[1-9]\d*$/u.test(taskId)) throw new Error("Stored task id is invalid");
		const numericId = Number(taskId.slice("task_".length));
		if (Number.isSafeInteger(numericId)) taskCounter = Math.max(taskCounter, numericId);
	}

	/** @param {RegistryEntry} entry */
	function snapshot(entry) {
		return {
			taskId: entry.taskId,
			cwd: entry.cwd(),
			isPrimary: entry.isPrimary,
			ready: Boolean(entry.handle.ready),
			starting: Boolean(entry.handle.starting),
			streaming: entry.streaming,
			unread: entry.unread,
			completed: entry.completed,
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

	/**
	 * @param {string} taskId
	 * @param {string} cwd
	 * @param {TaskMeta | undefined} meta
	 * @param {string | undefined} sessionFile
	 * @param {TaskActivity} [activity]
	 */
	function add(taskId, cwd, meta, sessionFile, activity = {}) {
		if (pool.has(taskId)) throw new Error(`Task id is already running: ${taskId}`);
		reserveTaskId(taskId);
		const claim = findClaim(cwd);
		if (claim) {
			throw new Error(
				claim.isPrimary
					? "That folder is the primary workspace and already running"
					: `A task is already running in that folder: ${claim.taskId}`,
			);
		}
		const fixedCwd = String(cwd);
		const handle = createHandle(taskId, fixedCwd, sessionFile);
		const entry = {
			taskId,
			cwd: () => fixedCwd,
			handle,
			isPrimary: false,
			streaming: false,
			unread: Number.isSafeInteger(activity.unread) && Number(activity.unread) > 0 ? Number(activity.unread) : 0,
			completed: Boolean(activity.completed),
			meta,
		};
		pool.set(taskId, entry);
		handle.start();
		return snapshot(entry);
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
			const taskId = `task_${++taskCounter}`;
			return add(taskId, cwd, meta, undefined);
		},

		/** Restore one previously persisted task without lowering the live pool to a newer cap. */
		/** @param {{ taskId: string, cwd: string, sessionFile?: string } & TaskMeta & TaskActivity} stored */
		restore(stored) {
			if (pool.size >= MAX_MAX_TASKS) throw new Error(`Task restore limit reached (${MAX_MAX_TASKS})`);
			return add(stored.taskId, stored.cwd, {
				...(stored.branch ? { branch: stored.branch } : {}),
				...(stored.sourceRepo ? { sourceRepo: stored.sourceRepo } : {}),
				...(stored.worktreePath ? { worktreePath: stored.worktreePath } : {}),
			}, stored.sessionFile, stored);
		},

		reserveTaskId,

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

		/**
		 * Track the small activity summary needed by the desktop task inbox.
		 * @param {string} taskId
		 * @param {{ type?: string, willRetry?: boolean }} payload
		 * @param {string} activeTaskId
		 */
		recordEvent(taskId, payload, activeTaskId) {
			const entry = taskId === primaryEntry.taskId ? primaryEntry : pool.get(taskId);
			if (!entry) return false;
			const before = `${entry.streaming}:${entry.unread}:${entry.completed}`;
			if (payload.type === "agent_start") {
				entry.streaming = true;
				entry.completed = false;
			} else if (payload.type === "message_end" && taskId !== activeTaskId) {
				entry.unread += 1;
			} else if (payload.type === "agent_end") {
				entry.streaming = Boolean(payload.willRetry);
				entry.completed = !payload.willRetry && taskId !== activeTaskId;
			}
			return before !== `${entry.streaming}:${entry.unread}:${entry.completed}`;
		},

		/** @param {string} taskId */
		activate(taskId) {
			const entry = taskId === primaryEntry.taskId ? primaryEntry : pool.get(taskId);
			if (!entry) return false;
			const changed = entry.unread > 0 || entry.completed;
			entry.unread = 0;
			entry.completed = false;
			return changed;
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
