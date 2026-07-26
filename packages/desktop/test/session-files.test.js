import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { prepareSessionImport, resolveKnownSessionFile } from "../src/session-files.js";

const knownPath = resolve("sessions", "known.jsonl");
const knownAliasPath = resolve("sessions", "known-alias.jsonl");
const otherPath = resolve("sessions", "other.jsonl");
const unavailablePath = resolve("private", "secret.txt");
const canonicalPaths = new Map([
	[knownPath, knownPath],
	[knownAliasPath, knownPath],
	[otherPath, otherPath],
]);

async function realpathImpl(path) {
	const canonical = canonicalPaths.get(path);
	if (!canonical) throw new Error("missing");
	return canonical;
}

test("resolves only files listed by the backend", async () => {
	const result = await resolveKnownSessionFile(
		knownPath,
		[{ path: knownPath, cwd: "C:\\repo" }],
		undefined,
		{ realpathImpl },
	);
	assert.deepEqual(result, { path: knownPath, cwd: "C:\\repo", isActive: false });

	await assert.rejects(
		resolveKnownSessionFile(
			otherPath,
			[{ path: knownPath }],
			undefined,
			{ realpathImpl },
		),
		/not available/,
	);
});

test("detects an active session through canonical path aliases", async () => {
	const result = await resolveKnownSessionFile(
		knownAliasPath,
		[{ path: knownPath, cwd: "C:\\repo" }],
		knownAliasPath,
		{ realpathImpl },
	);
	assert.deepEqual(result, { path: knownPath, cwd: "C:\\repo", isActive: true });
});

test("does not expose filesystem errors for an unavailable requested path", async () => {
	await assert.rejects(
		resolveKnownSessionFile(unavailablePath, [], undefined, { realpathImpl }),
		/Session file is unavailable/,
	);
});

function fakeImportFs({ firstChunk, size = 100, isFile = true, existing = [] }) {
	const copies = [];
	const existingSet = new Set(existing);
	return {
		copies,
		impls: {
			statImpl: async () => ({ isFile: () => isFile, size }),
			openImpl: async () => ({
				read: async (buffer) => {
					const written = buffer.write(firstChunk ?? "", 0, "utf8");
					return { bytesRead: written };
				},
				close: async () => {},
			}),
			accessImpl: async (path) => {
				if (!existingSet.has(path)) throw new Error("ENOENT");
			},
			copyFileImpl: async (source, target) => {
				copies.push({ source, target });
			},
		},
	};
}

const sessionsDir = resolve("sessions");

test("prepareSessionImport copies a valid JSONL under its own name", async () => {
	const fs = fakeImportFs({ firstChunk: '{"type":"session"}\n{"type":"message"}\n' });
	const target = await prepareSessionImport("C:\\downloads\\chat.jsonl", sessionsDir, fs.impls);
	assert.equal(target, join(sessionsDir, "chat.jsonl"));
	assert.deepEqual(fs.copies, [{ source: "C:\\downloads\\chat.jsonl", target }]);
});

test("prepareSessionImport suffixes the name when the target exists", async () => {
	const fs = fakeImportFs({
		firstChunk: '{"type":"session"}\n',
		existing: [join(sessionsDir, "chat.jsonl"), join(sessionsDir, "chat-imported-1.jsonl")],
	});
	const target = await prepareSessionImport("C:\\downloads\\chat.jsonl", sessionsDir, fs.impls);
	assert.equal(target, join(sessionsDir, "chat-imported-2.jsonl"));
});

test("prepareSessionImport rejects non-JSONL, empty, oversized, and non-file sources", async () => {
	await assert.rejects(
		prepareSessionImport("C:\\x.jsonl", sessionsDir, fakeImportFs({ firstChunk: "plain text\n" }).impls),
		/first line is not JSON/,
	);
	await assert.rejects(
		prepareSessionImport("C:\\x.jsonl", sessionsDir, fakeImportFs({ firstChunk: "[1,2]\n" }).impls),
		/not an object/,
	);
	await assert.rejects(
		prepareSessionImport("C:\\x.jsonl", sessionsDir, fakeImportFs({ firstChunk: "", size: 0 }).impls),
		/empty/,
	);
	await assert.rejects(
		prepareSessionImport(
			"C:\\x.jsonl",
			sessionsDir,
			fakeImportFs({ firstChunk: "{}", size: 512 * 1024 * 1024 }).impls,
		),
		/too large/,
	);
	await assert.rejects(
		prepareSessionImport("C:\\x", sessionsDir, fakeImportFs({ firstChunk: "{}", isFile: false }).impls),
		/Not a session JSONL file/,
	);
});
