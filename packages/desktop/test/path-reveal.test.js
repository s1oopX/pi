import assert from "node:assert/strict";
import { join, normalize, resolve, sep } from "node:path";
import { describe, it } from "node:test";
import { describeRevealTarget, resolveWorkspacePath } from "../src/path-reveal.js";

// Platform-appropriate absolute fixtures: C:\proj style on Windows, /proj on POSIX.
const workspace = resolve(sep, "proj");
const elsewhere = resolve(sep, "other");

describe("resolveWorkspacePath", () => {
	it("resolves relative paths against the workspace", () => {
		const abs = resolveWorkspacePath(workspace, join("src", "a.ts"));
		assert.ok(abs.endsWith(join("proj", "src", "a.ts")), abs);
	});

	it("keeps absolute paths", () => {
		const target = join(elsewhere, "file.ts");
		assert.equal(resolveWorkspacePath(workspace, target), normalize(target));
	});

	it("rejects empty inputs", () => {
		assert.throws(() => resolveWorkspacePath("", "a.ts"), /Workspace not set/);
		assert.throws(() => resolveWorkspacePath(workspace, "  "), /Path is empty/);
	});
});

describe("describeRevealTarget", () => {
	it("flags paths inside the workspace", () => {
		const result = describeRevealTarget(workspace, join(workspace, "src", "a.ts"));
		assert.equal(result.insideWorkspace, true);
	});

	it("flags paths outside the workspace", () => {
		const result = describeRevealTarget(workspace, join(elsewhere, "a.ts"));
		assert.equal(result.insideWorkspace, false);
	});
});
