import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { resolveKnownSessionFile } from "../src/session-files.js";

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
