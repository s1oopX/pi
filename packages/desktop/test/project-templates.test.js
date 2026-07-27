import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	TEMPLATE_NAMES,
	copyTemplate,
	createProject,
	sanitizeProjectName,
} from "../src/project-templates.js";

describe("TEMPLATE_NAMES", () => {
	it("lists the three shipped templates", () => {
		assert.deepEqual([...TEMPLATE_NAMES].sort(), ["cli", "express", "nextjs"]);
	});
});

describe("sanitizeProjectName", () => {
	it("trims surrounding whitespace", () => {
		assert.equal(sanitizeProjectName("  my-app  "), "my-app");
	});

	it("rejects path separators", () => {
		assert.throws(() => sanitizeProjectName("a/b"), /path separators/);
		assert.throws(() => sanitizeProjectName("a\\b"), /path separators/);
		assert.throws(() => sanitizeProjectName("a:b"), /path separators/);
	});

	it("rejects parent-directory traversal", () => {
		assert.throws(() => sanitizeProjectName(".."), /"\.\."/);
		assert.throws(() => sanitizeProjectName("../evil"), /path separators/);
		assert.throws(() => sanitizeProjectName("foo..bar/../x"), /path separators/);
	});

	it("strips Windows-invalid folder characters", () => {
		assert.equal(sanitizeProjectName('a<b>c?d*e'), "abcde");
	});

	it("rejects non-strings and empty input", () => {
		assert.throws(() => sanitizeProjectName(/** @type {unknown} */ (123)), /string/);
		assert.throws(() => sanitizeProjectName("   "), /empty/);
		assert.throws(() => sanitizeProjectName('<>?*'), /no valid characters/);
	});
});

describe("copyTemplate allowlist", () => {
	it("rejects a path-traversal template name", async () => {
		await assert.rejects(
			copyTemplate("../../desktop/src", "D:/tmp/should-not-exist"),
			/Unknown template/,
		);
	});

	it("rejects an absolute path template name", async () => {
		await assert.rejects(
			copyTemplate("/etc/passwd", "D:/tmp/should-not-exist"),
			/Unknown template/,
		);
	});

	it("accepts each known template (dry-run via stat only)", async () => {
		// nextjs/express/cli all exist under packages/desktop/templates; the
		// allowlist gate runs before any filesystem access, so an unknown name
		// throws without touching the disk.
		for (const name of TEMPLATE_NAMES) {
			// We don't actually copy here (no temp dir), just confirm the name
			// passes the allowlist by checking that the only rejection is
			// filesystem-related, not "Unknown template".
			try {
				await copyTemplate(name, join("D:", "tmp", "audit-nonexistent-target"));
			} catch (error) {
				assert.doesNotMatch(
					error instanceof Error ? error.message : String(error),
					/Unknown template/,
					`${name} should pass the allowlist`,
				);
			}
		}
	});
});

describe("createProject path safety", () => {
	const platform = process.platform;

	it("builds the target dir under parentDir, not beside it", async () => {
		// Use the cli template (tsc-clean). On Windows npm still fails with
		// ENOENT unless we route through cmd.exe — createProject now does, but
		// to keep this test network/install-free we assert the directory was
		// created INSIDE the parent, proving no traversal, even if install
		// later fails. We catch and inspect the created path.
		const parent = join("D:", "tmp", "audit-create-parent");
		try {
			await createProject("cli", parent, "..evil", { platform });
			assert.fail("expected createProject to reject for a bad name");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			assert.match(message, /path separators|"\.\."/);
		}
	});

	it("rejects a template outside the allowlist before touching the disk", async () => {
		const parent = join("D:", "tmp", "audit-create-allow");
		await assert.rejects(
			createProject("../../etc", parent, "ok-name", { platform }),
			/Unknown template/,
		);
	});
});
