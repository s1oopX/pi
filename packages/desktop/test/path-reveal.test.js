import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeRevealTarget, resolveWorkspacePath } from "../src/path-reveal.js";

describe("resolveWorkspacePath", () => {
	it("resolves relative paths against the workspace", () => {
		const abs = resolveWorkspacePath("C:\\proj", "src\\a.ts");
		assert.match(abs.replace(/\//g, "\\"), /proj\\src\\a\.ts$/i);
	});

	it("keeps absolute paths", () => {
		const abs = resolveWorkspacePath("C:\\proj", "D:\\other\\file.ts");
		assert.match(abs.replace(/\//g, "\\"), /^D:\\other\\file\.ts$/i);
	});

	it("rejects empty inputs", () => {
		assert.throws(() => resolveWorkspacePath("", "a.ts"), /Workspace not set/);
		assert.throws(() => resolveWorkspacePath("C:\\proj", "  "), /Path is empty/);
	});
});

describe("describeRevealTarget", () => {
	it("flags paths inside the workspace", () => {
		const result = describeRevealTarget("C:\\proj", "C:\\proj\\src\\a.ts");
		assert.equal(result.insideWorkspace, true);
	});

	it("flags paths outside the workspace", () => {
		const result = describeRevealTarget("C:\\proj", "D:\\other\\a.ts");
		assert.equal(result.insideWorkspace, false);
	});
});
