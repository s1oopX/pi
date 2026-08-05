import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createRollingLog, registerRendererLogEvents } from "../src/rolling-log.js";

/** In-memory fs standing in for appendFileSync/statSync/renames/unlinks. */
function fakeFs(initial = {}) {
	const files = new Map(Object.entries(initial));
	return {
		files,
		impls: {
			appendFileSyncImpl: (path, text) => {
				files.set(path, (files.get(path) ?? "") + text);
			},
			statSyncImpl: (path) => {
				if (!files.has(path)) throw new Error("ENOENT");
				return { size: Buffer.byteLength(files.get(path), "utf8") };
			},
			renameSyncImpl: (from, to) => {
				if (!files.has(from)) throw new Error("ENOENT");
				files.set(to, files.get(from));
				files.delete(from);
			},
			rmSyncImpl: (path) => {
				files.delete(path);
			},
			mkdirSyncImpl: () => {},
		},
	};
}

// Platform-native paths: the module joins with the host separator, so string
// literals with backslashes would break the Linux CI run.
const DIR = join("data", "logs");
const CURRENT = join(DIR, "pi-studio.log");
const HISTORY = (index) => join(DIR, `pi-studio.${index}.log`);

describe("createRollingLog", () => {
	it("appends timestamped single-line entries and escapes newlines", () => {
		const fs = fakeFs();
		const log = createRollingLog({
			directory: DIR,
			nowImpl: () => new Date("2026-07-27T01:02:03.000Z").getTime(),
			...fs.impls,
		});
		log.append("error", "backend:task_1", "boom\r\nsecond line");
		const content = fs.files.get(CURRENT);
		assert.match(content, /^2026-07-27T01:02:03\.000Z \[error\] backend:task_1 boom\\nsecond line\n$/u);
	});

	it("caps oversized entries", () => {
		const fs = fakeFs();
		const log = createRollingLog({ directory: DIR, ...fs.impls });
		log.append("info", "main", "x".repeat(64 * 1024));
		const content = fs.files.get(CURRENT);
		assert.ok(Buffer.byteLength(content, "utf8") < 20 * 1024);
	});

	it("redacts secrets and the user home before persisting", () => {
		const fs = fakeFs();
		const log = createRollingLog({ directory: DIR, homePath: "C:\\Users\\alice", ...fs.impls });
		log.append(
			"error",
			"backend:main",
			"apiKey=sk-abcdefghijklmnop Authorization: Bearer abc.def_123 path=C:/Users/alice/project url=https://example.test/?token=visible",
		);

		const content = fs.files.get(CURRENT);
		assert.doesNotMatch(content, /abcdefghijklmnop|abc\.def_123|visible|Users[\\/]alice/u);
		assert.match(content, /apiKey=<redacted>/u);
		assert.match(content, /Authorization: <authorization redacted>/u);
		assert.match(content, /path=<home>\/project/u);
		assert.match(content, /token=<redacted>/u);
	});

	it("initializes its size from an existing file and rotates on overflow", () => {
		const fs = fakeFs({ [CURRENT]: "y".repeat(90) });
		const log = createRollingLog({ directory: DIR, maxBytes: 100, maxFiles: 3, ...fs.impls });
		log.append("info", "main", "z".repeat(40)); // 90 + entry > 100 -> rotate first
		assert.equal(fs.files.get(HISTORY(1)), "y".repeat(90));
		assert.match(fs.files.get(CURRENT), /z{40}/u);
	});

	it("shifts older files and drops the oldest at the cap", () => {
		const fs = fakeFs({
			[CURRENT]: "current".padEnd(90, "c"),
			[HISTORY(1)]: "one",
			[HISTORY(2)]: "two",
		});
		const log = createRollingLog({ directory: DIR, maxBytes: 100, maxFiles: 3, ...fs.impls });
		log.append("info", "main", "n".repeat(40));
		assert.equal(fs.files.get(HISTORY(2)), "one");
		assert.equal(fs.files.get(HISTORY(1)), "current".padEnd(90, "c"));
		assert.equal(fs.files.has(HISTORY(3)), false, "the oldest file is dropped");
		assert.match(fs.files.get(CURRENT), /n{40}/u);
	});

	it("never throws when the filesystem fails", () => {
		const log = createRollingLog({
			directory: DIR,
			appendFileSyncImpl: () => {
				throw new Error("disk full");
			},
			statSyncImpl: () => {
				throw new Error("ENOENT");
			},
			renameSyncImpl: () => {},
			rmSyncImpl: () => {},
			mkdirSyncImpl: () => {},
		});
		assert.doesNotThrow(() => log.append("info", "main", "hello"));
	});

	it("exposes the current log path", () => {
		const fs = fakeFs();
		const log = createRollingLog({ directory: DIR, ...fs.impls });
		assert.equal(log.currentPath, CURRENT);
	});
});

describe("registerRendererLogEvents", () => {
	it("records renderer errors, crashes, and hangs", () => {
		const webContents = new EventEmitter();
		const entries = [];
		const getLog = () => ({
			append: (...entry) => entries.push(entry),
		});
		registerRendererLogEvents(webContents, getLog);

		webContents.emit("console-message", { level: "warning", message: "warning", lineNumber: 10, sourceId: "renderer.js" });
		webContents.emit("console-message", { level: "error", message: "uncaught", lineNumber: 42, sourceId: "renderer.js" });
		webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 7 });
		webContents.emit("unresponsive");

		assert.deepEqual(entries, [
			["error", "renderer", "uncaught (renderer.js:42)"],
			["error", "renderer", "render-process-gone: reason=crashed exitCode=7"],
			["error", "renderer", "renderer became unresponsive"],
		]);
	});
});
