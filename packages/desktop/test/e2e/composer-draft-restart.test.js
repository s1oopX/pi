import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertPrerequisites, launchStudio, LAUNCH_TIMEOUT_MS } from "./harness.mjs";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("composer draft survives an application restart", async (t) => {
	assertPrerequisites();
	const rootDir = mkdtempSync(join(tmpdir(), "pi-studio-draft-restart-"));
	const sourcePath = join(rootDir, "workspace", "notes.txt");
	const imagePath = join(rootDir, "workspace", "diagram.png");
	let studio;
	t.after(async () => {
		await studio?.close();
		rmSync(rootDir, { recursive: true, force: true, maxRetries: 5 });
	});

	try {
		studio = await launchStudio({
			rootDir,
			modelInput: ["text", "image"],
			setupWorkspace(workspaceDir) {
				mkdirSync(workspaceDir, { recursive: true });
				writeFileSync(sourcePath, "Persistent file reference.\n");
				writeFileSync(imagePath, Buffer.from(PNG_BASE64, "base64"));
			},
		});
		await studio.waitUntilReady();
		await studio.waitForWorkspaceSettled();
		await studio.page.locator(".composer-input").fill("Continue this draft after restart");
		await studio.page.locator(".composer-file-input").setInputFiles([sourcePath, imagePath]);
		await studio.page.locator(".composer-attachment-file").getByText("notes.txt", { exact: true }).waitFor();
		await studio.page.locator('img[alt="diagram.png"]').waitFor({ state: "visible" });

		await studio.close();
		studio = await launchStudio({ rootDir, modelInput: ["text", "image"] });
		await studio.waitUntilReady();
		await studio.waitForWorkspaceSettled();
		await studio.page.waitForFunction(
			(expected) => document.querySelector(".composer-input")?.value === expected,
			"Continue this draft after restart",
			{ timeout: LAUNCH_TIMEOUT_MS },
		);
		await studio.page.locator(".composer-attachment-file").getByText("notes.txt", { exact: true }).waitFor({
			state: "visible",
			timeout: LAUNCH_TIMEOUT_MS,
		});
		await studio.page.locator('img[alt="diagram.png"]').waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		assert.equal(await studio.page.locator(".composer-attachment").count(), 2);
	} catch (error) {
		await studio?.dumpDiagnostics();
		throw error;
	}
});
