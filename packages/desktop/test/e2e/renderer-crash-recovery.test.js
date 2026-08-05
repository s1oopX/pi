import assert from "node:assert/strict";
import { test } from "node:test";
import { LAUNCH_TIMEOUT_MS, launchStudio } from "./harness.mjs";

test("renderer reloads once after a crash and restores the draft", async (t) => {
	const studio = await launchStudio();
	t.after(async () => studio.close());

	await studio.waitUntilReady();
	await studio.page.locator(".composer-input").fill("survives renderer crash");
	await studio.page.waitForTimeout(100);

	const crashed = studio.page.waitForEvent("crash", { timeout: LAUNCH_TIMEOUT_MS });
	const recovered = studio.app.evaluate(({ BrowserWindow }) => new Promise((resolve) => {
		const webContents = BrowserWindow.getAllWindows()[0].webContents;
		webContents.once("did-finish-load", resolve);
		webContents.forcefullyCrashRenderer();
	}));
	await crashed;
	await recovered;
	const restoredDraft = await studio.app.evaluate(async ({ BrowserWindow }, { expected, timeoutMs }) => {
		const webContents = BrowserWindow.getAllWindows()[0].webContents;
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const value = await webContents.executeJavaScript("document.querySelector('.composer-input')?.value ?? null");
			if (value === expected) return value;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error("The recovered renderer did not restore the composer draft");
	}, {
		expected: "survives renderer crash",
		timeoutMs: LAUNCH_TIMEOUT_MS,
	});

	assert.equal(restoredDraft, "survives renderer crash");
	const repeatedCrashReloaded = await studio.app.evaluate(({ BrowserWindow }) => new Promise((resolve) => {
		const webContents = BrowserWindow.getAllWindows()[0].webContents;
		let reloaded = false;
		webContents.once("did-finish-load", () => {
			reloaded = true;
		});
		webContents.forcefullyCrashRenderer();
		setTimeout(() => resolve(reloaded), 500);
	}));
	assert.equal(repeatedCrashReloaded, false);
});
