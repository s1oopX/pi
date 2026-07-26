/**
 * One backend child process and every piece of state that belongs to it:
 * stdout JSONL reassembly, request correlation, restart backoff, the session
 * mutation queue, and the pending extension-UI store. main.js used to hold all
 * of this as module-level singletons for the single backend; the class exists
 * so several backends can run side by side (parallel tasks M1 — see
 * docs/parallel-tasks-design.md). Behavior is a verbatim port.
 *
 * Renderer-facing payloads emitted here (`backend:event` / `backend:status` /
 * `backend:log`) are tagged with `backendId`; the current renderer ignores the
 * extra field.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createBackendMutationQueue } from "./backend-mutation-queue.js";
import { createPendingExtensionUIRequestStore } from "./pending-extension-ui-requests.js";

// RPC messages include inline base64 image content. Keep a bounded but large
// enough frame buffer for multi-image prompts and get_messages responses.
const MAX_BACKEND_BUFFER_BYTES = 128 * 1024 * 1024;
const MAX_BACKEND_STDERR_BYTES = 64 * 1024;
const MAX_BACKEND_RESTART_ATTEMPTS = 3;

export class BackendHandle {
	/**
	 * @param {object} options
	 * @param {string} options.id stable identifier; "main" for the primary
	 * @param {() => string} options.getCwd spawn cwd provider (the primary
	 *   follows workspace switches between restarts)
	 * @param {() => string} options.getBackendPath
	 * @param {(channel: string, payload: object) => void} options.sendToRenderer
	 * @param {(cwd: string) => void} [options.onSessionChanged]
	 * @param {(payload: object) => void} [options.notify]
	 * @param {() => boolean} [options.isQuitting]
	 * @param {typeof spawn} [options.spawnImpl]
	 * @param {(path: string) => boolean} [options.existsSyncImpl]
	 * @param {() => number} [options.nowImpl]
	 */
	constructor({
		id,
		getCwd,
		getBackendPath,
		sendToRenderer,
		onSessionChanged = () => {},
		notify = () => {},
		isQuitting = () => false,
		spawnImpl = spawn,
		existsSyncImpl = existsSync,
		nowImpl = Date.now,
	}) {
		this.id = id;
		this.getCwd = getCwd;
		this.getBackendPath = getBackendPath;
		this.emitToRenderer = sendToRenderer;
		this.onSessionChanged = onSessionChanged;
		this.notify = notify;
		this.isQuitting = isQuitting;
		this.spawnImpl = spawnImpl;
		this.existsSyncImpl = existsSyncImpl;
		this.nowImpl = nowImpl;
		/** Last backend traffic (outgoing request or parsed stdout) for idle reaping. */
		this.lastActivityAt = nowImpl();

		this.child = undefined;
		this.buffer = "";
		this.bufferBytes = 0;
		this.requestCounter = 0;
		this.pendingRequests = new Map();
		this.pendingExtensionUIRequests = createPendingExtensionUIRequestStore();
		this.ready = false;
		this.starting = false;
		this.stderrTail = "";
		this.restartTimer = undefined;
		this.stableTimer = undefined;
		this.restartAttempts = 0;
		this.retryAt = 0;
		this.mutationQueue = createBackendMutationQueue();
	}

	/**
	 * @param {string} channel
	 * @param {object} payload
	 */
	send_(channel, payload) {
		this.emitToRenderer(channel, { ...payload, backendId: this.id });
	}

	statusSnapshot() {
		return {
			backendId: this.id,
			ready: this.ready,
			starting: this.starting,
			restarting: Boolean(this.restartTimer),
			retryInMs: this.retryAt ? Math.max(0, this.retryAt - Date.now()) : 0,
			restartAttempts: this.restartAttempts,
			backendPath: this.getBackendPath(),
			cwd: this.getCwd(),
		};
	}

	/** @param {string} line */
	parseLine_(line) {
		if (!line.trim()) {
			return;
		}
		this.lastActivityAt = this.nowImpl();
		let payload;
		try {
			payload = JSON.parse(line);
		} catch {
			this.send_("backend:log", { level: "warn", message: line.slice(0, 16 * 1024) });
			return;
		}

		if (payload.type === "response" && payload.id && this.pendingRequests.has(payload.id)) {
			const pending = this.pendingRequests.get(payload.id);
			this.pendingRequests.delete(payload.id);
			clearTimeout(pending.timeout);
			pending.resolve(payload);
			return;
		}

		if (payload.type === "session_changed" && typeof payload.cwd === "string") {
			this.onSessionChanged(payload.cwd);
		}
		this.pendingExtensionUIRequests.track(payload);
		this.notify(payload);
		this.send_("backend:event", payload);
	}

	/** @param {Buffer | string} chunk */
	handleStdout_(chunk) {
		this.buffer += chunk.toString("utf8");
		this.bufferBytes += chunk.length;
		if (this.bufferBytes > MAX_BACKEND_BUFFER_BYTES && !this.buffer.includes("\n")) {
			this.buffer = "";
			this.bufferBytes = 0;
			this.send_("backend:log", { level: "error", message: "Discarded an oversized backend output line" });
			return;
		}
		let newlineIndex = this.buffer.indexOf("\n");
		while (newlineIndex !== -1) {
			const line = this.buffer.slice(0, newlineIndex);
			this.buffer = this.buffer.slice(newlineIndex + 1);
			this.bufferBytes = Buffer.byteLength(this.buffer, "utf8");
			this.parseLine_(line);
			newlineIndex = this.buffer.indexOf("\n");
		}
	}

	/** @param {Error} error */
	rejectPendingRequests_(error) {
		for (const pending of this.pendingRequests.values()) {
			clearTimeout(pending.timeout);
			pending.reject(error);
		}
		this.pendingRequests.clear();
	}

	clearRestartTimers_() {
		clearTimeout(this.restartTimer);
		clearTimeout(this.stableTimer);
		this.restartTimer = undefined;
		this.stableTimer = undefined;
		this.retryAt = 0;
	}

	/** @param {string} reason */
	scheduleRestart_(reason) {
		clearTimeout(this.stableTimer);
		this.stableTimer = undefined;
		if (this.isQuitting() || this.child || this.restartTimer) return;
		if (this.restartAttempts >= MAX_BACKEND_RESTART_ATTEMPTS) {
			this.starting = false;
			this.retryAt = 0;
			this.send_("backend:status", {
				ready: false,
				error: `Pi backend stopped after ${MAX_BACKEND_RESTART_ATTEMPTS} restart attempts. ${reason}`,
			});
			return;
		}
		const delay = 1000 * 2 ** this.restartAttempts;
		this.restartAttempts += 1;
		this.starting = true;
		this.retryAt = Date.now() + delay;
		this.send_("backend:status", {
			ready: false,
			starting: true,
			restarting: true,
			retryInMs: delay,
			error: reason,
		});
		this.restartTimer = setTimeout(() => {
			this.restartTimer = undefined;
			this.retryAt = 0;
			this.start();
		}, delay);
	}

	start() {
		if (this.child) {
			return;
		}
		this.pendingExtensionUIRequests.clear();

		const backendPath = this.getBackendPath();
		if (!this.existsSyncImpl(backendPath)) {
			this.ready = false;
			this.send_("backend:status", {
				ready: false,
				error: `Pi backend not found: ${backendPath}`,
			});
			return;
		}

		this.buffer = "";
		this.bufferBytes = 0;
		this.retryAt = 0;
		const cwd = this.getCwd();
		const child = this.spawnImpl(backendPath, [], {
			cwd,
			env: {
				...process.env,
				PI_DESKTOP: "1",
			},
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		this.child = child;
		this.mutationQueue.invalidate();
		this.ready = false;
		this.starting = true;
		this.stderrTail = "";
		this.send_("backend:status", { ready: false, starting: true, backendPath, cwd });

		child.stdout.on("data", (chunk) => {
			if (this.child !== child) return;
			this.handleStdout_(chunk);
		});
		child.stderr.on("data", (chunk) => {
			if (this.child !== child) return;
			const message = chunk.toString("utf8").slice(-16 * 1024);
			this.stderrTail = `${this.stderrTail}${message}`.slice(-MAX_BACKEND_STDERR_BYTES);
			this.send_("backend:log", { level: "error", message });
		});
		child.on("exit", (code, signal) => {
			if (this.child !== child) {
				return;
			}
			this.mutationQueue.invalidate();
			this.pendingExtensionUIRequests.clear();
			this.ready = false;
			this.starting = false;
			this.child = undefined;
			const message = `Pi backend exited code=${code} signal=${signal}. ${this.stderrTail}`;
			this.rejectPendingRequests_(new Error(message));
			this.scheduleRestart_(message);
		});
		child.on("error", (error) => {
			if (this.child !== child) {
				return;
			}
			this.mutationQueue.invalidate();
			this.pendingExtensionUIRequests.clear();
			this.child = undefined;
			this.ready = false;
			this.starting = false;
			this.rejectPendingRequests_(error);
			this.scheduleRestart_(error.message);
		});

		void this.request({ type: "get_state" }, { allowStarting: true, timeoutMs: 15000 })
			.then(() => {
				if (this.child !== child) return;
				this.starting = false;
				this.ready = true;
				this.send_("backend:status", { ready: true, backendPath, cwd });
				clearTimeout(this.stableTimer);
				this.stableTimer = setTimeout(() => {
					if (this.child === child && this.ready) this.restartAttempts = 0;
				}, 30000);
			})
			.catch((error) => {
				if (this.child !== child) return;
				this.starting = false;
				this.ready = false;
				this.send_("backend:status", { ready: false, error: `Pi backend failed to initialize: ${error.message}` });
				child.kill();
			});
	}

	stop() {
		this.clearRestartTimers_();
		this.restartAttempts = 0;
		this.mutationQueue.invalidate();
		this.pendingExtensionUIRequests.clear();
		if (!this.child) {
			return;
		}
		const child = this.child;
		this.child = undefined;
		this.ready = false;
		this.starting = false;
		this.rejectPendingRequests_(new Error("Pi backend stopped"));
		child.kill();
	}

	/**
	 * @param {{ type?: string, id?: string } & Record<string, unknown>} command
	 * @param {{ allowStarting?: boolean, timeoutMs?: number }} [options]
	 * @returns {Promise<any>}
	 */
	request(command, { allowStarting = false, timeoutMs = 30000 } = {}) {
		if ((!this.ready && !(allowStarting && this.starting)) || !this.child?.stdin?.writable) {
			return Promise.reject(new Error(this.starting ? "Pi backend is starting" : "Pi backend is not running"));
		}

		this.lastActivityAt = this.nowImpl();
		// Callers may supply their own request id (bash runs correlate streamed
		// bash_execution_update events by it); otherwise assign one.
		const id = typeof command?.id === "string" && command.id ? command.id : `desktop_${++this.requestCounter}`;
		const payload = { ...command, id };
		const stdin = this.child.stdin;

		return new Promise((resolve, reject) => {
			const timeout = timeoutMs > 0
				? setTimeout(() => {
						this.pendingRequests.delete(id);
						reject(new Error(`Timed out waiting for ${command.type}`));
					}, timeoutMs)
				: undefined;

			this.pendingRequests.set(id, { resolve, reject, timeout });
			stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
				if (!error) {
					return;
				}
				clearTimeout(timeout);
				this.pendingRequests.delete(id);
				reject(error);
			});
		});
	}

	/**
	 * @param {object} command
	 * @returns {Promise<void>}
	 */
	send(command) {
		if (!this.ready || !this.child?.stdin?.writable) {
			return Promise.reject(new Error("Pi backend is not running"));
		}
		const stdin = this.child.stdin;
		return new Promise((resolve, reject) => {
			stdin.write(`${JSON.stringify(command)}\n`, (error) => {
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			});
		});
	}
}
