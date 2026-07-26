import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRollingLog } from "../src/rolling-log.js";

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

const DIR = "C:\\data\\logs";
const CURRENT = `${DIR}\\pi-studio.log`;

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

	it("initializes its size from an existing file and rotates on overflow", () => {
		const fs = fakeFs({ [CURRENT]: "y".repeat(90) });
		const log = createRollingLog({ directory: DIR, maxBytes: 100, maxFiles: 3, ...fs.impls });
		log.append("info", "main", "z".repeat(40)); // 90 + entry > 100 -> rotate first
		assert.equal(fs.files.get(`${DIR}\\pi-studio.1.log`), "y".repeat(90));
		assert.match(fs.files.get(CURRENT), /z{40}/u);
	});

	it("shifts older files and drops the oldest at the cap", () => {
		const fs = fakeFs({
			[CURRENT]: "current".padEnd(90, "c"),
			[`${DIR}\\pi-studio.1.log`]: "one",
			[`${DIR}\\pi-studio.2.log`]: "two",
		});
		const log = createRollingLog({ directory: DIR, maxBytes: 100, maxFiles: 3, ...fs.impls });
		log.append("info", "main", "n".repeat(40));
		assert.equal(fs.files.get(`${DIR}\\pi-studio.2.log`), "one");
		assert.equal(fs.files.get(`${DIR}\\pi-studio.1.log`), "current".padEnd(90, "c"));
		assert.equal(fs.files.has(`${DIR}\\pi-studio.3.log`), false, "the oldest file is dropped");
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
