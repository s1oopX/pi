import assert from "node:assert/strict";
import test from "node:test";
import { assertPrerequisites, launchStudio, LAUNCH_TIMEOUT_MS } from "./harness.mjs";

const FIRST_COMMAND = `node -e "console.log('tab-one-start');setTimeout(()=>console.log('tab-one-end'),4000)"`;
const SECOND_COMMAND = `node -e "console.log('tab-two-start');setTimeout(()=>console.log('tab-two-end'),10000)"`;

test("workbench terminals run concurrently and stop by tab", async (t) => {
	assertPrerequisites();

	const studio = await launchStudio();
	t.after(() => studio.close());

	try {
		await studio.waitUntilReady();
		await studio.page.locator(".top-bar-workbench-toggle").click();
		await studio.page.locator(".workbench-launcher-item").nth(1).click();

		const tabs = studio.page.locator(".workbench-terminal-tab");
		const activeInput = studio.page.locator(".workbench-terminal-session:not([hidden]) input");
		const activeOutput = studio.page.locator(".workbench-terminal-session:not([hidden]) .terminal-panel");

		await activeInput.fill(FIRST_COMMAND);
		await activeInput.press("Enter");
		await activeOutput.getByText("tab-one-start", { exact: true }).waitFor({ timeout: LAUNCH_TIMEOUT_MS });

		await studio.page.locator(".workbench-terminal-action").nth(1).click();
		assert.equal(await tabs.count(), 2);
		await activeInput.fill(SECOND_COMMAND);
		await activeInput.press("Enter");
		await activeOutput.getByText("tab-two-start", { exact: true }).waitFor({ timeout: LAUNCH_TIMEOUT_MS });
		await studio.page.waitForFunction(
			() => document.querySelectorAll(".workbench-terminal-running").length === 2,
			undefined,
			{ timeout: LAUNCH_TIMEOUT_MS },
		);

		await studio.page.locator(".workbench-terminal-session:not([hidden]) .workbench-primary.secondary").click();
		await studio.page.waitForFunction(
			() => document.querySelectorAll(".workbench-terminal-running").length === 1,
			undefined,
			{ timeout: LAUNCH_TIMEOUT_MS },
		);

		await studio.page.locator("#workbench-terminal-tab-1").click();
		await activeOutput.getByText("tab-one-start", { exact: true }).waitFor({ timeout: LAUNCH_TIMEOUT_MS });
		await activeOutput.getByText("tab-one-end", { exact: true }).waitFor({ timeout: LAUNCH_TIMEOUT_MS });

		await studio.page.locator("#workbench-terminal-tab-2").click();
		await activeOutput.getByText("tab-two-start", { exact: true }).waitFor({ timeout: LAUNCH_TIMEOUT_MS });
		await studio.page.locator(".workbench-terminal-action").first().click();
		assert.equal(await tabs.count(), 1);
		await studio.page.locator(".workbench-terminal-action").nth(1).click();
		assert.equal(await tabs.count(), 2);
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
