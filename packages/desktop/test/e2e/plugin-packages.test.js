import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { assertPrerequisites, launchStudio, LAUNCH_TIMEOUT_MS } from "./harness.mjs";

function extensionSource(version) {
	return `import { writeFileSync } from "node:fs";
import { join } from "node:path";
export default function () {
  writeFileSync(join(process.cwd(), "plugin-package.marker"), "${version}");
}
`;
}

test("plugin packages: install, update, and remove a local package", async (t) => {
	assertPrerequisites();

	let extensionPath;
	let markerPath;
	let packageDir;
	const studio = await launchStudio({
		reply: "ok",
		setupWorkspace: (workspaceDir, tempRoot) => {
			packageDir = join(tempRoot, "plugin-package");
			extensionPath = join(packageDir, "mark.js");
			markerPath = join(workspaceDir, "plugin-package.marker");
			mkdirSync(packageDir, { recursive: true });
			writeFileSync(
				join(packageDir, "package.json"),
				`${JSON.stringify({
					name: "pi-studio-e2e-plugin-package",
					private: true,
					type: "module",
					pi: { extensions: ["./mark.js"] },
				}, null, 2)}\n`,
			);
			writeFileSync(extensionPath, extensionSource("v1"));
		},
	});
	t.after(() => studio.close());

	try {
		await studio.waitUntilReady();
		studio.page.on("dialog", (dialog) => {
			void dialog.accept();
		});

		await studio.page.locator(".sidebar-footer .sidebar-action-btn").click();
		await studio.page.locator('.settings-nav-item[data-route="resources"]').click();
		await studio.page.locator("#resource-package-source").fill(packageDir);
		await studio.page.locator(".resource-package-install").click();

		const packageRow = studio.page.locator(".resource-package-row").filter({ hasText: "plugin-package" });
		await packageRow.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		for (let attempt = 0; attempt < 60 && !existsSync(markerPath); attempt += 1) {
			await studio.page.waitForTimeout(250);
		}
		assert.equal(readFileSync(markerPath, "utf8"), "v1");
		await studio.page.locator(".resource-name").filter({ hasText: "mark.js" }).waitFor({
			state: "visible",
			timeout: LAUNCH_TIMEOUT_MS,
		});

		writeFileSync(extensionPath, extensionSource("v2"));
		await packageRow.locator("button").first().click();
		for (let attempt = 0; attempt < 60 && readFileSync(markerPath, "utf8") !== "v2"; attempt += 1) {
			await studio.page.waitForTimeout(250);
		}
		assert.equal(readFileSync(markerPath, "utf8"), "v2");

		await packageRow.locator("button").last().click();
		await packageRow.waitFor({ state: "detached", timeout: LAUNCH_TIMEOUT_MS });
		await studio.page.locator(".resource-name").filter({ hasText: "mark.js" }).waitFor({
			state: "detached",
			timeout: LAUNCH_TIMEOUT_MS,
		});
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
