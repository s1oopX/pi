/**
 * End-to-end project trust: a workspace with a project-local .pi extension is
 * untrusted by default, so the extension must NOT run (no marker file) and the
 * trust banner shows. After the user trusts the folder, the backend reloads,
 * the extension runs, and the banner clears.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { assertPrerequisites, launchStudio, LAUNCH_TIMEOUT_MS } from "./harness.mjs";

// A project extension that writes a marker the instant it loads — i.e. proof
// the project's code executed with full access.
const MARK_EXTENSION = `import { writeFileSync } from "node:fs";
import { join } from "node:path";
export default function () {
  writeFileSync(join(process.cwd(), ".pi", "loaded.marker"), "loaded");
}
`;

test("project trust: an untrusted project's extension does not run until trusted", async (t) => {
	assertPrerequisites();

	let workspace;
	const studio = await launchStudio({
		reply: "ok",
		setupWorkspace: (workspaceDir) => {
			workspace = workspaceDir;
			const extDir = join(workspaceDir, ".pi", "extensions");
			mkdirSync(extDir, { recursive: true });
			writeFileSync(join(extDir, "mark.js"), MARK_EXTENSION);
		},
	});
	t.after(() => studio.close());

	const markerPath = join(workspace, ".pi", "loaded.marker");

	try {
		await studio.waitUntilReady();

		// Untrusted by default: the banner shows and the extension has not run.
		const banner = studio.page.locator(".trust-banner");
		await banner.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		assert.equal(existsSync(markerPath), false, "the project extension must not run before trust");

		// Trust the folder; the backend persists it and hot-reloads resources.
		await studio.page.locator(".trust-banner-btn").click();

		// After trust the extension loads and writes its marker.
		let ran = false;
		for (let attempt = 0; attempt < 40 && !ran; attempt++) {
			ran = existsSync(markerPath);
			if (!ran) await studio.page.waitForTimeout(500);
		}
		assert.equal(ran, true, "the project extension should run once the folder is trusted");

		// The banner clears once trusted.
		await banner.waitFor({ state: "hidden", timeout: LAUNCH_TIMEOUT_MS });

		// Revoke from Settings -> Resources -> Trusted folders: the stored
		// decision disappears and the workspace drops back to untrusted, so the
		// banner returns after the hot-reload.
		await studio.page.locator(".sidebar-footer .sidebar-action-btn").click();
		await studio.page.locator('.settings-nav-item[data-route="resources"]').click();
		const trustRow = studio.page.locator(".trust-folder-row");
		await trustRow.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await trustRow.locator(".trust-folder-forget").click();
		await trustRow.waitFor({ state: "detached", timeout: LAUNCH_TIMEOUT_MS });
		await studio.page.locator(".settings-back-btn").click();
		await banner.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
