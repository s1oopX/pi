/**
 * Tiny zero-dependency rolling file log for the desktop main process. One
 * current file (`pi-studio.log`) rotates into numbered history files on a
 * size cap; the oldest history file is dropped. Logging must never take the
 * app down, so every filesystem touch is failure-swallowed. Injectable fs and
 * clock keep it unit-testable without disk.
 */

import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const MAX_ENTRY_BYTES = 16 * 1024;

/**
 * @param {{
 *   directory: string,
 *   baseName?: string,
 *   maxBytes?: number,
 *   maxFiles?: number,
 *   nowImpl?: () => number,
 *   appendFileSyncImpl?: (path: string, text: string) => void,
 *   statSyncImpl?: (path: string) => { size: number },
 *   renameSyncImpl?: (from: string, to: string) => void,
 *   rmSyncImpl?: (path: string) => void,
 *   mkdirSyncImpl?: (path: string) => void,
 * }} options
 */
export function createRollingLog({
	directory,
	baseName = "pi-studio",
	maxBytes = DEFAULT_MAX_BYTES,
	maxFiles = DEFAULT_MAX_FILES,
	nowImpl = Date.now,
	appendFileSyncImpl = appendFileSync,
	statSyncImpl = statSync,
	renameSyncImpl = renameSync,
	rmSyncImpl = rmSync,
	mkdirSyncImpl = (path) => mkdirSync(path, { recursive: true }),
}) {
	const currentPath = join(directory, `${baseName}.log`);
	const historyPath = (/** @type {number} */ index) => join(directory, `${baseName}.${index}.log`);

	let ready = false;
	let currentBytes = 0;

	function ensureReady() {
		if (ready) return;
		try {
			mkdirSyncImpl(directory);
		} catch {
			// The append will surface (and swallow) any real problem.
		}
		try {
			currentBytes = statSyncImpl(currentPath).size;
		} catch {
			currentBytes = 0;
		}
		ready = true;
	}

	function rotate() {
		try {
			rmSyncImpl(historyPath(maxFiles - 1));
		} catch {
			// Nothing to drop.
		}
		for (let index = maxFiles - 2; index >= 1; index--) {
			try {
				renameSyncImpl(historyPath(index), historyPath(index + 1));
			} catch {
				// Gaps in history are fine.
			}
		}
		try {
			renameSyncImpl(currentPath, historyPath(1));
		} catch {
			// If the shift fails, keep appending to the oversized file.
		}
		currentBytes = 0;
	}

	return {
		currentPath,

		/**
		 * @param {string} level e.g. "info" | "warn" | "error"
		 * @param {string} source e.g. "main", "backend:task_1"
		 * @param {string} message multi-line input is escaped onto one line
		 */
		append(level, source, message) {
			try {
				ensureReady();
				const flattened = String(message ?? "")
					.replace(/\r?\n/gu, "\\n")
					.slice(0, MAX_ENTRY_BYTES);
				const line = `${new Date(nowImpl()).toISOString()} [${level}] ${source} ${flattened}\n`;
				const lineBytes = Buffer.byteLength(line, "utf8");
				if (currentBytes > 0 && currentBytes + lineBytes > maxBytes) {
					rotate();
				}
				appendFileSyncImpl(currentPath, line);
				currentBytes += lineBytes;
			} catch {
				// Logging must never break the app.
			}
		},
	};
}
